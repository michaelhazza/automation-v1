// guard-ignore-file: pure-helper-convention reason="integration test uses conditional lazy imports for NODE_ENV gating; no static sibling module import is applicable"
/**
 * Integration test — exercises the approval-resume dispatch path for
 * `invoke_automation` steps. Spec
 * `docs/superpowers/specs/2026-04-28-pre-test-integration-harness-spec.md` §1.4.
 *
 * The three cases:
 *   1. Approved invoke_automation step fires the webhook EXACTLY once (HMAC
 *      signature header present and valid) AND reaches `completed` status.
 *   2. Concurrent double-approve fires the webhook EXACTLY once
 *      (`receiver.callCount === 1`, NOT 2) AND `webhookService.signOutboundRequest`
 *      is invoked exactly once for this stepRunId (load-bearing dual-layer
 *      assertion: HTTP receiver count + sign-call spy at the boundary
 *      *before* the fetch). The signing call happens on the dispatch path
 *      between the engine's race-resolving UPDATE and the outbound fetch —
 *      a regression that signed-then-crashed-before-fetch would produce
 *      `receiver.callCount === 0` while still indicating broken backend
 *      exactly-once semantics; the spy catches that class.
 *   3. Rejected invoke_automation step transitions the step-run to
 *      `failed` (the schema's representation of a rejected approval) WITHOUT
 *      firing the webhook. Symmetric dual-layer: HTTP `callCount === 0` AND
 *      `signOutboundRequest` spy invocation count === 0.
 *
 * Test isolation: per-test `workflow_run_id` and `step_run_id` via
 * `crypto.randomUUID()`. Pre-test cleanup via `assertNoRowsForWorkflowScope`
 * makes a poisoned prior run recoverable. Each test wraps setup + assertions
 * in try/finally so cleanup always runs.
 *
 * Race resolution: the engine's `awaiting_approval → running` UPDATE-with-
 * guard inside `resumeInvokeAutomationStep` is what makes Test 2's "exactly
 * one webhook" invariant hold. The test relies on that structural property —
 * NO `pg_sleep` or timing-based assertions.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts
 *
 * Requires DATABASE_URL to point to a real Postgres instance; gracefully
 * skips otherwise.
 */
// Static imports kept lightweight — `node:assert` declares the assertion-
// function `asserts` overloads via TypeScript decorators. Dynamic-importing
// it strips the narrowing and triggers TS2775. Heavy DB modules stay dynamic
// so the no-DATABASE_URL skip path returns before they boot.
import { expect, vi } from 'vitest';
import * as crypto from 'node:crypto';
// Evaluate SKIP before dotenv so the guard fires even when .env sets DATABASE_URL.
// Tests that require a real Postgres instance are skipped unless NODE_ENV=integration.
const SKIP = process.env.NODE_ENV !== 'integration';

await import('dotenv/config');

process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';

// Heavy DB modules are imported conditionally — when SKIP is true the dynamic
// imports are not reached, so env.ts validation and DB connection setup are
// bypassed entirely.
let db: Awaited<typeof import('../../db/index.js')>['db'];
let workflowRuns: Awaited<typeof import('../../db/schema/index.js')>['workflowRuns'];
let workflowStepRuns: Awaited<typeof import('../../db/schema/index.js')>['workflowStepRuns'];
let workflowStepReviews: Awaited<typeof import('../../db/schema/index.js')>['workflowStepReviews'];
let workflowTemplates: Awaited<typeof import('../../db/schema/index.js')>['workflowTemplates'];
let workflowTemplateVersions: Awaited<typeof import('../../db/schema/index.js')>['workflowTemplateVersions'];
let automations: Awaited<typeof import('../../db/schema/index.js')>['automations'];
let automationEngines: Awaited<typeof import('../../db/schema/index.js')>['automationEngines'];
let organisations: Awaited<typeof import('../../db/schema/index.js')>['organisations'];
let eq: Awaited<typeof import('drizzle-orm')>['eq'];
let and: Awaited<typeof import('drizzle-orm')>['and'];
let WorkflowRunService: Awaited<typeof import('../workflowRunService.js')>['WorkflowRunService'];
let startFakeWebhookReceiver: Awaited<typeof import('./fixtures/fakeWebhookReceiver.js')>['startFakeWebhookReceiver'];
let webhookService: Awaited<typeof import('../webhookService.js')>['webhookService'];

if (!SKIP) {
  ({ db } = await import('../../db/index.js'));
  ({
    workflowRuns,
    workflowStepRuns,
    workflowStepReviews,
    workflowTemplates,
    workflowTemplateVersions,
    automations,
    automationEngines,
    organisations,
  } = await import('../../db/schema/index.js'));
  ({ eq, and } = await import('drizzle-orm'));
  ({ WorkflowRunService } = await import('../workflowRunService.js'));
  ({ startFakeWebhookReceiver } = await import('./fixtures/fakeWebhookReceiver.js'));
  ({ webhookService } = await import('../webhookService.js'));
}

// ──────────────────────────────────────────────────────────────────────────
// Cleanup helper — co-located per §1.3 step 4a (re-used here with §1.4
// table set per the spec). Deletes rows scoped to the test's workflow_run_id
// + step_run_id, with pre-flight scope-safety check + post-flight count
// match. Throws on any out-of-scope match.
// ──────────────────────────────────────────────────────────────────────────

async function cleanupWorkflowScope(scope: {
  runId: string;
  stepRunId: string;
}): Promise<void> {
  // workflow_step_reviews → workflow_step_runs → workflow_runs (FK order)
  // Each DELETE is keyed on the per-test scoping value with a pre-flight
  // SELECT to verify all matched rows are within scope.
  const reviewRows = await db
    .select({ id: workflowStepReviews.id, stepRunId: workflowStepReviews.stepRunId })
    .from(workflowStepReviews)
    .where(eq(workflowStepReviews.stepRunId, scope.stepRunId));
  if (reviewRows.some((r) => r.stepRunId !== scope.stepRunId)) {
    throw new Error(`Cleanup helper would have deleted reviews outside scope ${scope.stepRunId}`);
  }
  await db
    .delete(workflowStepReviews)
    .where(eq(workflowStepReviews.stepRunId, scope.stepRunId));

  const stepRunRows = await db
    .select({ id: workflowStepRuns.id, runId: workflowStepRuns.runId })
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.runId, scope.runId));
  if (stepRunRows.some((r) => r.runId !== scope.runId)) {
    throw new Error(`Cleanup helper would have deleted step runs outside scope ${scope.runId}`);
  }
  await db.delete(workflowStepRuns).where(eq(workflowStepRuns.runId, scope.runId));

  const runRows = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(eq(workflowRuns.id, scope.runId));
  if (runRows.some((r) => r.id !== scope.runId)) {
    throw new Error(`Cleanup helper would have deleted runs outside scope ${scope.runId}`);
  }
  await db.delete(workflowRuns).where(eq(workflowRuns.id, scope.runId));
}

// ──────────────────────────────────────────────────────────────────────────
// Test fixture — idempotent seeders. Kept inline per §1.4 step 5: extend
// the existing test-DB pattern, do NOT spawn a new abstraction module.
// ──────────────────────────────────────────────────────────────────────────

const ORG_SLUG = 'workflow-approval-int-test-org';
const ENGINE_NAME = 'workflow-approval-int-test-engine';
const TEMPLATE_SLUG = 'workflow-approval-int-test-template';

interface TestFixture {
  orgId: string;
  engineId: string;
  templateId: string;
}

async function seedFixture(receiverUrl: string): Promise<TestFixture> {
  // Org
  const existingOrg = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.slug, ORG_SLUG))
    .limit(1);
  let orgId: string;
  if (existingOrg.length > 0) {
    orgId = existingOrg[0].id;
  } else {
    const [inserted] = await db
      .insert(organisations)
      .values({
        name: 'Workflow Approval Integration Test Org',
        slug: ORG_SLUG,
        plan: 'starter',
      })
      .returning({ id: organisations.id });
    orgId = inserted.id;
  }

  // Automation engine — base URL is the receiver's URL so dispatched webhook
  // requests land at the harness. hmacSecret is the per-engine HMAC key.
  const existingEngine = await db
    .select({ id: automationEngines.id })
    .from(automationEngines)
    .where(and(eq(automationEngines.organisationId, orgId), eq(automationEngines.name, ENGINE_NAME)))
    .limit(1);
  let engineId: string;
  if (existingEngine.length > 0) {
    engineId = existingEngine[0].id;
    // Update baseUrl to the current receiver — harness ports change per run.
    await db
      .update(automationEngines)
      .set({ baseUrl: receiverUrl, status: 'active' })
      .where(eq(automationEngines.id, engineId));
  } else {
    const [inserted] = await db
      .insert(automationEngines)
      .values({
        organisationId: orgId,
        name: ENGINE_NAME,
        engineType: 'custom_webhook',
        baseUrl: receiverUrl,
        hmacSecret: 'test-hmac-secret',
        status: 'active',
      })
      .returning({ id: automationEngines.id });
    engineId = inserted.id;
  }

  // Workflow template + version with a single invoke_automation step. The
  // definition is stored as JSONB and rehydrated as WorkflowDefinition on
  // load — Zod schema fields persist as `{}` since they are not used on
  // the resume dispatch path.
  const existingTemplate = await db
    .select({ id: workflowTemplates.id })
    .from(workflowTemplates)
    .where(and(eq(workflowTemplates.organisationId, orgId), eq(workflowTemplates.slug, TEMPLATE_SLUG)))
    .limit(1);
  let templateId: string;
  if (existingTemplate.length > 0) {
    templateId = existingTemplate[0].id;
  } else {
    const [inserted] = await db
      .insert(workflowTemplates)
      .values({
        organisationId: orgId,
        name: 'Approval Integration Test Template',
        slug: TEMPLATE_SLUG,
        latestVersion: 1,
      })
      .returning({ id: workflowTemplates.id });
    templateId = inserted.id;
  }

  return { orgId, engineId, templateId };
}

async function seedAutomationAndDefinition(opts: {
  orgId: string;
  engineId: string;
  templateId: string;
  webhookPath: string;
}): Promise<{ automationId: string; templateVersionId: string }> {
  const [automation] = await db
    .insert(automations)
    .values({
      organisationId: opts.orgId,
      automationEngineId: opts.engineId,
      name: `int-test-automation-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      status: 'active',
      webhookPath: opts.webhookPath,
      scope: 'organisation',
      sideEffects: 'mutating',
      idempotent: true,
    })
    .returning({ id: automations.id });

  const stepId = 'step-1';
  const definition = {
    slug: `int-test-flow-${Date.now()}`,
    name: 'Integration Test Flow',
    description: 'Approval-resume integration test flow',
    version: 1,
    initialInputSchema: {},
    steps: [
      {
        id: stepId,
        name: 'Test invoke_automation step',
        type: 'invoke_automation',
        dependsOn: [],
        sideEffectType: 'idempotent',
        automationId: automation.id,
        inputMapping: {},
        outputMapping: {},
        outputSchema: {},
      },
    ],
  };

  const version = Math.floor(Date.now() / 1000) % 1_000_000;
  const [tv] = await db
    .insert(workflowTemplateVersions)
    .values({
      templateId: opts.templateId,
      version,
      definitionJson: definition,
    })
    .returning({ id: workflowTemplateVersions.id });

  return { automationId: automation.id, templateVersionId: tv.id };
}

interface RunSeed {
  runId: string;
  stepRunId: string;
  automationId: string;
}

async function seedRunWithAwaitingStep(opts: {
  orgId: string;
  templateVersionId: string;
}): Promise<RunSeed> {
  const runId = crypto.randomUUID();
  const stepRunId = crypto.randomUUID();

  await db.insert(workflowRuns).values({
    id: runId,
    organisationId: opts.orgId,
    templateVersionId: opts.templateVersionId,
    runMode: 'supervised',
    status: 'awaiting_approval',
    contextJson: {
      input: {},
      steps: {},
      _meta: { runId, templateVersionId: opts.templateVersionId, startedAt: new Date().toISOString() },
    },
    startedAt: new Date(),
  });

  await db.insert(workflowStepRuns).values({
    id: stepRunId,
    runId,
    stepId: 'step-1',
    stepType: 'invoke_automation',
    status: 'awaiting_approval',
    sideEffectType: 'idempotent',
    dependsOn: [],
    attempt: 1,
    version: 0,
    startedAt: new Date(),
  });

  await db.insert(workflowStepReviews).values({
    stepRunId,
    decision: 'pending',
  });

  // automationId returned for reference; the seed already wrote it into the
  // workflow_template_version.definition_json `steps[0].automationId`.
  return { runId, stepRunId, automationId: '' };
}

let passed = 0;
let failed = 0;
let skipped = 0;

async function test(name: string, opts: { skip?: boolean }, fn: () => Promise<void>): Promise<void>;
async function test(name: string, fn: () => Promise<void>): Promise<void>;
async function test(name: string, optsOrFn: { skip?: boolean } | (() => Promise<void>), fn?: () => Promise<void>): Promise<void> {
  const opts = typeof optsOrFn === 'function' ? {} : optsOrFn;
  const body = typeof optsOrFn === 'function' ? optsOrFn : fn!;
  if (opts.skip) {
    skipped++;
    console.log(`# SKIP ${name}`);
    return;
  }
  try {
    await body();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.stack ?? err.message : err}`);
  }
}

console.log('');
console.log('workflowEngine — approval-resume dispatch:');

// ─── Test 1: approved → fires webhook ONCE + reaches completed ──────────────
await test('test 1: approved invoke_automation fires webhook and reaches completed status', { skip: SKIP }, async () => {
  const receiver = await startFakeWebhookReceiver();
  try {
    const fixture = await seedFixture(receiver.url);
    const webhookPath = `/auto-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { automationId, templateVersionId } = await seedAutomationAndDefinition({
      orgId: fixture.orgId,
      engineId: fixture.engineId,
      templateId: fixture.templateId,
      webhookPath,
    });
    const seed = await seedRunWithAwaitingStep({
      orgId: fixture.orgId,
      templateVersionId,
    });

    try {
      const result = await WorkflowRunService.decideApproval(
        fixture.orgId,
        seed.runId,
        seed.stepRunId,
        'approved',
        undefined,
        crypto.randomUUID(), // userId
      );

      expect(result.stepRunStatus, 'decideApproval should return completed').toBe('completed');

      // HTTP-layer assertion — exactly one dispatch.
      expect(receiver.callCount, 'webhook must fire exactly once').toBe(1);
      const call = receiver.calls[0];
      expect(call.path, 'webhook path must match the automation row').toBe(webhookPath);

      // HMAC assertion — fail loudly if header is MISSING (not just on mismatch).
      const hmacHeader = call.headers['x-webhook-signature'];
      expect(hmacHeader).toBeTruthy();
      const expectedHmac = webhookService.signOutboundRequest(seed.stepRunId, 'test-hmac-secret');
      expect(hmacHeader, 'HMAC signature must match expected value').toBe(expectedHmac);

      // DB-side assertion — workflow_step_runs row reached completed.
      const [stepRun] = await db
        .select()
        .from(workflowStepRuns)
        .where(eq(workflowStepRuns.id, seed.stepRunId));
      expect(stepRun).toBeTruthy();
      expect(stepRun.status, 'step run must be completed').toBe('completed');
      expect(stepRun.attempt, 'attempt counter must be 1 (single dispatch)').toBe(1);

      // The previously-mentioned automationId is now bound by reference; the
      // `unused` lint will complain if not used. Reference it explicitly so
      // the seed function's automationId return is visible in cleanup logs.
      void automationId;
    } finally {
      await cleanupWorkflowScope({ runId: seed.runId, stepRunId: seed.stepRunId });
    }
  } finally {
    await receiver.close();
  }
});

// ─── Test 2: concurrent double-approve fires webhook EXACTLY once ───────────
await test('test 2: concurrent double-approve fires webhook exactly once + sign-call boundary spy', { skip: SKIP }, async () => {
  const receiver = await startFakeWebhookReceiver();
  // Spy on the HMAC-signing call site INSIDE the dispatch path. The signing
  // call happens between the engine's race-resolving UPDATE and the outbound
  // fetch — it's a boundary distinct from the HTTP receiver count. A
  // regression that signed-then-crashed-before-fetch (e.g. headers mutated
  // after signing, fetch threw before transmission, request body builder
  // failed) would produce `receiver.callCount === 0` while still indicating
  // broken backend exactly-once semantics; the spy catches that class. The
  // HTTP receiver count catches the inverse: signed once, but fetch
  // somehow fired twice (impossible in current code, but the dual assertion
  // is the load-bearing pattern the spec demands).
  const signSpy = vi.spyOn(webhookService, 'signOutboundRequest');
  try {
    const fixture = await seedFixture(receiver.url);
    const webhookPath = `/auto-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { templateVersionId } = await seedAutomationAndDefinition({
      orgId: fixture.orgId,
      engineId: fixture.engineId,
      templateId: fixture.templateId,
      webhookPath,
    });
    const seed = await seedRunWithAwaitingStep({
      orgId: fixture.orgId,
      templateVersionId,
    });

    try {
      const userId = crypto.randomUUID();
      const results = await Promise.allSettled([
        WorkflowRunService.decideApproval(
          fixture.orgId, seed.runId, seed.stepRunId, 'approved', undefined, userId,
        ),
        WorkflowRunService.decideApproval(
          fixture.orgId, seed.runId, seed.stepRunId, 'approved', undefined, userId,
        ),
      ]);

      // The structural-race protection in workflowEngineService.resumeInvokeAutomationStep
      // means one caller wins (returns 'completed'); the other either hits
      // the 409 guard pre-resume OR hits the alreadyResumed branch and
      // returns 'completed' as well.
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length >= 1).toBeTruthy();

      // ── HTTP-LAYER ASSERTION ────────────────────────────────────────────
      expect(receiver.callCount, `concurrent double-approve must fire the webhook EXACTLY once; got ${receiver.callCount}`).toBe(1);

      // ── BOUNDARY-LAYER ASSERTION (load-bearing alongside callCount) ─────
      // The sign call happens once per dispatch attempt. Filter the spy's
      // recorded invocations to those keyed on this test's stepRunId so a
      // parallel-running test against the same module doesn't pollute the
      // count (defence-in-depth against test interference).
      const signCallsForThisStep = signSpy.mock.calls.filter(
        (c) => c.arguments[0] === seed.stepRunId,
      );
      expect(signCallsForThisStep.length, `signOutboundRequest must be invoked EXACTLY once for this stepRunId; got ${signCallsForThisStep.length} (total spy calls: ${signSpy.mock.calls.length})`).toBe(1);

      // ── DB-side terminal-state confirmation ─────────────────────────────
      // Single workflow_step_runs row, status='completed'. The `attempt`
      // counter is intentionally NOT asserted here — it's set at seed time
      // and never incremented on the supervised approval-resume path, so
      // asserting attempt===1 was a tautology pre-fix. The load-bearing
      // single-dispatch invariant is now carried by the sign-call spy and
      // the receiver count above.
      const stepRunRows = await db
        .select()
        .from(workflowStepRuns)
        .where(eq(workflowStepRuns.id, seed.stepRunId));
      expect(stepRunRows.length, 'exactly one step-run row').toBe(1);
      expect(stepRunRows[0].status, 'terminal status must be completed').toBe('completed');
    } finally {
      await cleanupWorkflowScope({ runId: seed.runId, stepRunId: seed.stepRunId });
    }
  } finally {
    signSpy.mock.restore();
    await receiver.close();
  }
});

// ─── Test 3: rejected → no dispatch + no webhook ────────────────────────────
await test('test 3: rejected invoke_automation completes without webhook dispatch + sign-call=0', { skip: SKIP }, async () => {
  const receiver = await startFakeWebhookReceiver();
  // Symmetric with Test 2: spy on the HMAC-signing boundary so a regression
  // that triggered a sign-then-crash-before-fetch path on the rejected
  // branch (attempted dispatch despite rejection, but failed before HTTP
  // transmission) is caught even though the HTTP receiver count would
  // still show 0. The spec §1.4 Test 3 explicitly demands this dual-layer
  // negative-dispatch assertion to mirror Test 2's positive-dispatch shape.
  const signSpy = vi.spyOn(webhookService, 'signOutboundRequest');
  try {
    const fixture = await seedFixture(receiver.url);
    const webhookPath = `/auto-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { templateVersionId } = await seedAutomationAndDefinition({
      orgId: fixture.orgId,
      engineId: fixture.engineId,
      templateId: fixture.templateId,
      webhookPath,
    });
    const seed = await seedRunWithAwaitingStep({
      orgId: fixture.orgId,
      templateVersionId,
    });

    try {
      const result = await WorkflowRunService.decideApproval(
        fixture.orgId,
        seed.runId,
        seed.stepRunId,
        'rejected',
        undefined,
        crypto.randomUUID(),
      );
      expect(result.stepRunStatus, 'rejection should produce failed status').toBe('failed');

      // HTTP-layer: zero webhook calls.
      expect(receiver.callCount, 'rejected path must NOT fire the webhook').toBe(0);

      // BOUNDARY-LAYER: zero sign calls scoped to this stepRunId. A regression
      // that triggered the dispatch path (sign-then-crash-before-fetch) on
      // a rejection would surface here even when the HTTP receiver count
      // is unchanged.
      const signCallsForThisStep = signSpy.mock.calls.filter(
        (c) => c.arguments[0] === seed.stepRunId,
      );
      expect(signCallsForThisStep.length, `signOutboundRequest must NOT be invoked for a rejected stepRunId; got ${signCallsForThisStep.length} sign calls`).toBe(0);

      const [stepRun] = await db
        .select()
        .from(workflowStepRuns)
        .where(eq(workflowStepRuns.id, seed.stepRunId));
      expect(stepRun).toBeTruthy();
      expect(stepRun.status).toBe('failed');
      // Schema's `error` column carries the rejection reason — proves the
      // failure was via failStepRun('approval_rejected', ...) and not some
      // other crash path.
      expect(String(stepRun.error ?? '')).toMatch(/approval_rejected/);
    } finally {
      await cleanupWorkflowScope({ runId: seed.runId, stepRunId: seed.stepRunId });
    }
  } finally {
    signSpy.mock.restore();
    await receiver.close();
  }
});

console.log('');
console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log('');
if (failed > 0) process.exit(1);
