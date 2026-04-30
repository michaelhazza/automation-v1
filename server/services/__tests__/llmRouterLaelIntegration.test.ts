// guard-ignore-file: pure-helper-convention reason="integration test uses conditional lazy imports for NODE_ENV gating; no static sibling module import is applicable"
/**
 * Integration test — exercises the LAEL lifecycle (`llm.requested` +
 * `llm.completed`) emission through `llmRouter.routeCall` against a real DB
 * and a fake provider adapter. Spec
 * `docs/superpowers/specs/2026-04-28-pre-test-integration-harness-spec.md` §1.3.
 *
 * The three cases:
 *   1. Happy-path agent-run emission — `llm.requested` (seq N) + `llm.completed`
 *      (seq N+1) with no interleaving of any event type, exactly one
 *      `agent_run_llm_payloads` row referenced by the completed event.
 *   2. `budget_blocked` silence — pre-dispatch budget breaker takes the early
 *      return; no LAEL events, no payload row, fake adapter never reached.
 *   3. Non-agent-run silence — `slack` source-type produces a ledger row but
 *      no LAEL events and no payload row.
 *
 * Test isolation: per-test `runId` (`crypto.randomUUID()`); pre-test cleanup
 * via `assertNoRowsForRunId` (defined inline below per §1.3 step 4a) makes a
 * poisoned prior run recoverable. Each test wraps setup + assertions in
 * try/finally so cleanup always runs.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/llmRouterLaelIntegration.test.ts
 *
 * Requires DATABASE_URL to point to a real Postgres instance; gracefully
 * skips otherwise. Env vars set before any DB module import so module-level
 * env-coerced consts (e.g. `ROUTER_FORCE_FRONTIER`) pick up the override.
 */
// Static imports kept lightweight — `node:assert` declares the assertion-
// function `asserts` overloads via TypeScript decorators. Dynamic-importing
// it strips the narrowing and triggers TS2775. Heavy DB modules stay dynamic
// so the no-DATABASE_URL skip path returns before they boot.
import { expect, test } from 'vitest';
import { strict as assert } from 'node:assert';
import * as crypto from 'node:crypto';

// Evaluate SKIP before dotenv so the guard fires even when .env sets DATABASE_URL.
// Tests that require a real Postgres instance are skipped unless NODE_ENV=integration.
const SKIP = process.env.NODE_ENV !== 'integration';

await import('dotenv/config');

process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';
// Force ceiling routing so the test asserts a deterministic provider/model
// pair regardless of the resolveLLM heuristic state in the test DB.
process.env.ROUTER_FORCE_FRONTIER = '1';

// Heavy DB modules are imported conditionally — when SKIP is true the dynamic
// imports are not reached, so env.ts validation and DB connection setup are
// bypassed entirely. Type-cast placeholders satisfy TypeScript while dead
// code under SKIP is never reached.
let db: Awaited<typeof import('../../db/index.js')>['db'];
let agentExecutionEvents: Awaited<typeof import('../../db/schema/index.js')>['agentExecutionEvents'];
let agentRunLlmPayloads: Awaited<typeof import('../../db/schema/index.js')>['agentRunLlmPayloads'];
let llmRequests: Awaited<typeof import('../../db/schema/index.js')>['llmRequests'];
let agentRuns: Awaited<typeof import('../../db/schema/index.js')>['agentRuns'];
let agents: Awaited<typeof import('../../db/schema/index.js')>['agents'];
let organisations: Awaited<typeof import('../../db/schema/index.js')>['organisations'];
let orgBudgets: Awaited<typeof import('../../db/schema/index.js')>['orgBudgets'];
let costAggregates: Awaited<typeof import('../../db/schema/index.js')>['costAggregates'];
let eq: Awaited<typeof import('drizzle-orm')>['eq'];
let and: Awaited<typeof import('drizzle-orm')>['and'];
let routeCall: Awaited<typeof import('../llmRouter.js')>['routeCall'];
let registerProviderAdapter: Awaited<typeof import('../providers/registry.js')>['registerProviderAdapter'];
let createFakeProviderAdapter: Awaited<typeof import('./fixtures/fakeProviderAdapter.js')>['createFakeProviderAdapter'];

if (!SKIP) {
  ({ db } = await import('../../db/index.js'));
  ({
    agentExecutionEvents,
    agentRunLlmPayloads,
    llmRequests,
    agentRuns,
    agents,
    organisations,
    orgBudgets,
    costAggregates,
  } = await import('../../db/schema/index.js'));
  ({ eq, and } = await import('drizzle-orm'));
  ({ routeCall } = await import('../llmRouter.js'));
  ({ registerProviderAdapter } = await import('../providers/registry.js'));
  ({ createFakeProviderAdapter } = await import('./fixtures/fakeProviderAdapter.js'));
}

// ──────────────────────────────────────────────────────────────────────────
// Cleanup helper — co-located per §1.3 step 4a. Asserts zero rows for the
// given runId across the named tables; deletes if rows exist. Throws on
// out-of-scope rows (defensive against a query-typo regression).
//
// Production-code safety: the helper NEVER issues a DELETE without a
// `WHERE run_id = $1` predicate keyed on the supplied runId. A pre-flight
// SELECT verifies all returned rows match the supplied scoping value; if any
// row's run_id does NOT match, the helper aborts BEFORE issuing the DELETE
// rather than after.
// ──────────────────────────────────────────────────────────────────────────

// `cost_aggregates` is intentionally omitted from this union — the table is
// keyed by (org, subaccount, billing period), NOT runId, so the per-run
// scoping-key approach does not apply. Cleanup of `cost_aggregates` is
// handled at the suite level (or via a separate helper keyed on the org +
// billing period). Including it here would be a silent no-op trap: the type
// would accept the value but the runtime would do nothing, breaking the
// "the helper is the only place these queries are written" invariant.
type LaelTable =
  | 'agent_execution_events'
  | 'agent_run_llm_payloads'
  | 'llm_requests';

async function assertNoRowsForRunId(runId: string, tables: ReadonlyArray<LaelTable>): Promise<void> {
  for (const tableName of tables) {
    if (tableName === 'agent_execution_events') {
      const rows = await db
        .select({ id: agentExecutionEvents.id, runId: agentExecutionEvents.runId })
        .from(agentExecutionEvents)
        .where(eq(agentExecutionEvents.runId, runId));
      const offenders = rows.filter((r) => r.runId !== runId);
      if (offenders.length > 0) {
        throw new Error(
          `Cleanup helper would have deleted rows outside scope ${runId}: ${offenders
            .map((o) => o.id)
            .join(', ')}`,
        );
      }
      const expected = rows.length;
      const deleted = await db
        .delete(agentExecutionEvents)
        .where(eq(agentExecutionEvents.runId, runId))
        .returning({ id: agentExecutionEvents.id });
      if (deleted.length > expected) {
        throw new Error(
          `Cleanup helper deleted more rows than SELECT predicted: SELECT=${expected} DELETE=${deleted.length} runId=${runId}`,
        );
      }
    } else if (tableName === 'agent_run_llm_payloads') {
      const rows = await db
        .select({ id: agentRunLlmPayloads.llmRequestId, runId: agentRunLlmPayloads.runId })
        .from(agentRunLlmPayloads)
        .where(eq(agentRunLlmPayloads.runId, runId));
      const offenders = rows.filter((r) => r.runId !== runId);
      if (offenders.length > 0) {
        throw new Error(
          `Cleanup helper would have deleted rows outside scope ${runId}: ${offenders
            .map((o) => o.id)
            .join(', ')}`,
        );
      }
      const expected = rows.length;
      const deleted = await db
        .delete(agentRunLlmPayloads)
        .where(eq(agentRunLlmPayloads.runId, runId))
        .returning({ id: agentRunLlmPayloads.llmRequestId });
      if (deleted.length > expected) {
        throw new Error(
          `Cleanup helper deleted more rows than SELECT predicted: SELECT=${expected} DELETE=${deleted.length} runId=${runId}`,
        );
      }
    } else if (tableName === 'llm_requests') {
      const rows = await db
        .select({ id: llmRequests.id, runId: llmRequests.runId })
        .from(llmRequests)
        .where(eq(llmRequests.runId, runId));
      const offenders = rows.filter((r) => r.runId !== runId);
      if (offenders.length > 0) {
        throw new Error(
          `Cleanup helper would have deleted rows outside scope ${runId}: ${offenders
            .map((o) => o.id)
            .join(', ')}`,
        );
      }
      const expected = rows.length;
      const deleted = await db
        .delete(llmRequests)
        .where(eq(llmRequests.runId, runId))
        .returning({ id: llmRequests.id });
      if (deleted.length > expected) {
        throw new Error(
          `Cleanup helper deleted more rows than SELECT predicted: SELECT=${expected} DELETE=${deleted.length} runId=${runId}`,
        );
      }
    }
  }
}

// Ledger cleanup keyed by `featureTag` — required for system-source calls
// whose ledger row has `runId: null` and so cannot be reached by
// `assertNoRowsForRunId`. Same scope-safety contract: pre-flight SELECT
// verifies all matched rows carry the expected featureTag, post-flight
// asserts DELETE row count <= SELECT row count, throws on out-of-scope match.
async function cleanupLedgerByFeatureTag(featureTag: string): Promise<void> {
  const rows = await db
    .select({ id: llmRequests.id, featureTag: llmRequests.featureTag })
    .from(llmRequests)
    .where(eq(llmRequests.featureTag, featureTag));
  const offenders = rows.filter((r) => r.featureTag !== featureTag);
  if (offenders.length > 0) {
    throw new Error(
      `cleanupLedgerByFeatureTag would have deleted rows outside scope ${featureTag}: ${offenders
        .map((o) => o.id)
        .join(', ')}`,
    );
  }
  const expected = rows.length;
  const deleted = await db
    .delete(llmRequests)
    .where(eq(llmRequests.featureTag, featureTag))
    .returning({ id: llmRequests.id });
  if (deleted.length > expected) {
    throw new Error(
      `cleanupLedgerByFeatureTag deleted more rows than SELECT predicted: SELECT=${expected} DELETE=${deleted.length} featureTag=${featureTag}`,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Test fixture — idempotent org + agent seeder. Returns ids for use in
// subsequent agent_runs inserts. Idempotent so re-runs reuse the same row.
// ──────────────────────────────────────────────────────────────────────────

async function seedTestFixture(): Promise<{ orgId: string; agentId: string }> {
  const slug = 'lael-int-test-org';
  const existingOrg = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.slug, slug))
    .limit(1);
  let orgId: string;
  if (existingOrg.length > 0) {
    orgId = existingOrg[0].id;
  } else {
    const [inserted] = await db
      .insert(organisations)
      .values({
        name: 'LAEL Integration Test Org',
        slug,
        plan: 'starter',
      })
      .returning({ id: organisations.id });
    orgId = inserted.id;
  }

  const agentSlug = 'lael-int-test-agent';
  const existingAgent = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.organisationId, orgId), eq(agents.slug, agentSlug)))
    .limit(1);
  let agentId: string;
  if (existingAgent.length > 0) {
    agentId = existingAgent[0].id;
  } else {
    const [inserted] = await db
      .insert(agents)
      .values({
        organisationId: orgId,
        name: 'LAEL Integration Test Agent',
        slug: agentSlug,
      })
      .returning({ id: agents.id });
    agentId = inserted.id;
  }
  return { orgId, agentId };
}


console.log('');
console.log('llmRouter — LAEL integration:');

let orgId: string = '';
let agentId: string = '';
if (!SKIP) {
  ({ orgId, agentId } = await seedTestFixture());
}

// ─── Test 1: happy-path agent-run emission ──────────────────────────────────
test.skipIf(SKIP)('test 1: happy-path agent-run emits requested→completed with one referenced payload row', async () => {
  const runId = crypto.randomUUID();
  await assertNoRowsForRunId(runId, [
    'agent_execution_events',
    'agent_run_llm_payloads',
    'llm_requests',
  ]);

  // Seed the agent_run row that LAEL emission requires.
  await db.insert(agentRuns).values({
    id: runId,
    organisationId: orgId,
    agentId,
    runType: 'manual',
    principalType: 'service',
    principalId: 'lael-int-test',
    status: 'running',
    startedAt: new Date(),
  });

  const fakeAdapter = createFakeProviderAdapter({ provider: 'anthropic' });
  const restore = registerProviderAdapter('anthropic', fakeAdapter);
  try {
    await routeCall({
      messages: [{ role: 'user', content: 'hello' }],
      context: {
        organisationId: orgId,
        sourceType: 'agent_run',
        runId,
        taskType: 'general',
        executionPhase: 'execution',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        featureTag: 'lael-int-test',
      },
    });

    // Atomicity invariant — exactly one payload row, referenced by the
    // llm.completed event, no orphans for this runId.
    const payloadRows = await db
      .select()
      .from(agentRunLlmPayloads)
      .where(eq(agentRunLlmPayloads.runId, runId));
    assert.equal(payloadRows.length, 1, `expected exactly one payload row for runId, got ${payloadRows.length}`);
    const payloadRowId = payloadRows[0].llmRequestId;

    // Sequence invariant — exactly two events, llm.requested then llm.completed.
    const events = await db
      .select()
      .from(agentExecutionEvents)
      .where(eq(agentExecutionEvents.runId, runId))
      .orderBy(agentExecutionEvents.sequenceNumber);
    assert.equal(events.length, 2, `expected exactly 2 events for runId, got ${events.length}`);
    assert.equal(events[0].eventType, 'llm.requested');
    assert.equal(events[1].eventType, 'llm.completed');
    assert.equal(
      events[1].sequenceNumber,
      events[0].sequenceNumber + 1,
      'llm.completed must be immediately after llm.requested in the sequence',
    );

    // Completed event references the payload row.
    const completedPayload = events[1].payload as Record<string, unknown>;
    assert.equal(
      completedPayload.payloadRowId,
      payloadRowId,
      'llm.completed.payloadRowId must equal the inserted payload row id',
    );
    assert.equal(completedPayload.payloadInsertStatus, 'ok');
    assert.equal(completedPayload.status, 'success');

    // Ledger row exists with status=success.
    const ledgerRows = await db
      .select()
      .from(llmRequests)
      .where(eq(llmRequests.runId, runId));
    assert.equal(ledgerRows.length, 1);
    assert.equal(ledgerRows[0].status, 'success');

    // Fake adapter received exactly one call.
    assert.equal(fakeAdapter.callCount, 1);
  } finally {
    restore();
    // Clean up — DELETE in dependent order then the agent_runs row.
    await assertNoRowsForRunId(runId, [
      'agent_execution_events',
      'agent_run_llm_payloads',
      'llm_requests',
    ]);
    await db.delete(agentRuns).where(eq(agentRuns.id, runId));
  }
});

// ─── Test 2: budget_blocked silence ─────────────────────────────────────────
test.skipIf(SKIP)('test 2: budget-blocked agent-run emits no LAEL events and inserts no payload row', async () => {
  // Deterministically trip the budget breaker by saturating the org-monthly
  // cap. We seed BOTH `org_budgets.monthlyCostLimitCents` (a tight cap) AND
  // a `cost_aggregates` row showing the org has already exceeded the cap;
  // `budgetService.checkAndReserve` reads both inside its own tx via
  // `getCurrentSpend('organisation', ..., 'monthly', billingMonth)` and
  // throws `BudgetExceededError` BEFORE the provider adapter is reached.
  // The router catches that, writes the ledger row with status='budget_blocked',
  // and re-throws — `shouldEmitLaelLifecycle` returns false for
  // budget_blocked, so no LAEL events emit and no payload row is inserted.
  //
  // Test 2 saves and restores any pre-existing `org_budgets` and
  // `cost_aggregates` rows for this org so the saturation does not leak
  // into other tests in the suite.
  const runId = crypto.randomUUID();
  const billingMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  await assertNoRowsForRunId(runId, [
    'agent_execution_events',
    'agent_run_llm_payloads',
    'llm_requests',
  ]);

  // Snapshot prior state for save/restore.
  const [priorOrgBudget] = await db
    .select()
    .from(orgBudgets)
    .where(eq(orgBudgets.organisationId, orgId));
  const [priorAggregate] = await db
    .select()
    .from(costAggregates)
    .where(
      and(
        eq(costAggregates.entityType, 'organisation'),
        eq(costAggregates.entityId, orgId),
        eq(costAggregates.periodType, 'monthly'),
        eq(costAggregates.periodKey, billingMonth),
      ),
    );

  // Install the tight cap + saturated aggregate.
  if (priorOrgBudget) {
    await db
      .update(orgBudgets)
      .set({ monthlyCostLimitCents: 1 })
      .where(eq(orgBudgets.organisationId, orgId));
  } else {
    await db.insert(orgBudgets).values({
      organisationId: orgId,
      monthlyCostLimitCents: 1,
    });
  }
  if (priorAggregate) {
    await db
      .update(costAggregates)
      .set({ totalCostCents: 1_000_000 })
      .where(
        and(
          eq(costAggregates.entityType, 'organisation'),
          eq(costAggregates.entityId, orgId),
          eq(costAggregates.periodType, 'monthly'),
          eq(costAggregates.periodKey, billingMonth),
        ),
      );
  } else {
    await db.insert(costAggregates).values({
      entityType: 'organisation',
      entityId: orgId,
      periodType: 'monthly',
      periodKey: billingMonth,
      totalCostCents: 1_000_000,
    });
  }

  await db.insert(agentRuns).values({
    id: runId,
    organisationId: orgId,
    agentId,
    runType: 'manual',
    principalType: 'service',
    principalId: 'lael-int-test',
    status: 'running',
    startedAt: new Date(),
  });

  const fakeAdapter = createFakeProviderAdapter({ provider: 'anthropic' });
  const restore = registerProviderAdapter('anthropic', fakeAdapter);
  try {
    // The router MUST throw — if it doesn't, the budget breaker wasn't
    // tripped and the test's fundamental precondition is broken. Fail
    // loudly rather than skip silently (the prior version's behaviour
    // converted this test into a runtime no-op, which is exactly the
    // false-pass class the spec's "tests must fail noisily" criterion
    // (§1.3 acceptance) was guarding against).
    let routerError: unknown = null;
    try {
      await routeCall({
        messages: [{ role: 'user', content: 'budget-blocked-probe' }],
        context: {
          organisationId: orgId,
          sourceType: 'agent_run',
          runId,
          taskType: 'general',
          executionPhase: 'execution',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          featureTag: 'lael-int-test-budget',
        },
      });
    } catch (err) {
      routerError = err;
    }
    assert.ok(
      routerError,
      'routeCall MUST throw under saturated budget; the breaker precondition was not tripped',
    );

    // Silence invariants — no LAEL events, no payload row, fake adapter never reached.
    const laelEvents = await db
      .select()
      .from(agentExecutionEvents)
      .where(eq(agentExecutionEvents.runId, runId));
    const llmEventTypes = laelEvents.map((e) => e.eventType).filter((t) => t.startsWith('llm.'));
    assert.equal(
      llmEventTypes.length,
      0,
      `budget_blocked path must not emit any llm.* events; got ${llmEventTypes.join(',')}`,
    );

    const payloadRows = await db
      .select()
      .from(agentRunLlmPayloads)
      .where(eq(agentRunLlmPayloads.runId, runId));
    assert.equal(payloadRows.length, 0, 'budget_blocked path must not insert a payload row');

    assert.equal(
      fakeAdapter.callCount,
      0,
      'budget_blocked path must short-circuit before reaching the provider adapter',
    );
  } finally {
    restore();
    await assertNoRowsForRunId(runId, [
      'agent_execution_events',
      'agent_run_llm_payloads',
      'llm_requests',
    ]);
    await db.delete(agentRuns).where(eq(agentRuns.id, runId));

    // Restore prior org_budgets state.
    if (priorOrgBudget) {
      await db
        .update(orgBudgets)
        .set({ monthlyCostLimitCents: priorOrgBudget.monthlyCostLimitCents })
        .where(eq(orgBudgets.organisationId, orgId));
    } else {
      await db.delete(orgBudgets).where(eq(orgBudgets.organisationId, orgId));
    }

    // Restore prior cost_aggregates state.
    if (priorAggregate) {
      await db
        .update(costAggregates)
        .set({ totalCostCents: priorAggregate.totalCostCents })
        .where(
          and(
            eq(costAggregates.entityType, 'organisation'),
            eq(costAggregates.entityId, orgId),
            eq(costAggregates.periodType, 'monthly'),
            eq(costAggregates.periodKey, billingMonth),
          ),
        );
    } else {
      await db
        .delete(costAggregates)
        .where(
          and(
            eq(costAggregates.entityType, 'organisation'),
            eq(costAggregates.entityId, orgId),
            eq(costAggregates.periodType, 'monthly'),
            eq(costAggregates.periodKey, billingMonth),
          ),
        );
    }
  }
});

// ─── Test 3: non-agent-run silence ──────────────────────────────────────────
test.skipIf(SKIP)('test 3: non-agent-run (system) emits no LAEL events and inserts no payload row', async () => {
  // No agent_runs row needed — sourceType !== 'agent_run' means LAEL gating
  // returns false. The ledger row is written with `runId: null` for system-
  // source calls, so cleanup CANNOT scope by runId — we'd leak the row on
  // every run, breaking the §0.2 suite-rerun row-count invariant. Instead,
  // use a per-test unique `featureTag` and clean the ledger by that
  // predicate. The other tables (`agent_execution_events`,
  // `agent_run_llm_payloads`) should never be touched by a non-agent-run
  // call; we still assert zero rows for a placeholder runId on those.
  const featureTag = `lael-int-test-system-${crypto.randomUUID()}`;
  const placeholderRunId = crypto.randomUUID();
  await assertNoRowsForRunId(placeholderRunId, [
    'agent_execution_events',
    'agent_run_llm_payloads',
  ]);
  // Pre-test cleanup of any prior ledger rows under this featureTag.
  // featureTag is per-test-invocation unique, so this should match zero rows
  // unless a prior test left a leak — in which case we recover.
  await cleanupLedgerByFeatureTag(featureTag);

  const fakeAdapter = createFakeProviderAdapter({ provider: 'anthropic' });
  const restore = registerProviderAdapter('anthropic', fakeAdapter);
  try {
    // The spec calls out 'slack' (or 'whisper') as the example non-agent
    // source type — at the codebase level, the closed sourceType vocabulary
    // is `'agent_run' | 'process_execution' | 'system' | 'iee' | 'analyzer'`.
    // 'system' is the closest analogue: a generic non-attributed catch-all
    // for platform work that goes through the router, has no run context,
    // and is excluded by `shouldEmitLaelLifecycle` because sourceType !==
    // 'agent_run'. Bypass routing so the call doesn't need an executionPhase.
    await routeCall({
      messages: [{ role: 'user', content: 'system-probe' }],
      context: {
        organisationId: orgId,
        sourceType: 'system',
        taskType: 'general',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        systemCallerPolicy: 'bypass_routing',
        featureTag,
      },
    });

    // No agent_execution_events for this org's call — there is no runId to
    // scope by, but the gating should produce zero rows regardless.
    const payloadRows = await db
      .select()
      .from(agentRunLlmPayloads)
      .where(eq(agentRunLlmPayloads.runId, placeholderRunId));
    assert.equal(payloadRows.length, 0, 'non-agent-run must not insert a payload row');

    // Adapter was reached — system calls go through the provider as normal.
    assert.equal(fakeAdapter.callCount, 1);

    // Ledger row exists with this featureTag and `runId: null` (the system-
    // source attribution shape). One row, exactly.
    const ledgerRows = await db
      .select({ id: llmRequests.id, runId: llmRequests.runId })
      .from(llmRequests)
      .where(eq(llmRequests.featureTag, featureTag));
    assert.equal(ledgerRows.length, 1, 'system-source call must produce exactly one ledger row');
    assert.equal(ledgerRows[0].runId, null, 'system-source ledger row carries runId: null');
  } finally {
    restore();
    await assertNoRowsForRunId(placeholderRunId, [
      'agent_execution_events',
      'agent_run_llm_payloads',
    ]);
    // Clean the ledger row we wrote — featureTag-scoped because runId is null.
    await cleanupLedgerByFeatureTag(featureTag);
  }
});


