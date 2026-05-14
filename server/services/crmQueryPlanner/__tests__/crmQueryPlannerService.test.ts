/**
 * crmQueryPlannerService.test.ts — spec §20.2
 * Orchestration tests with injected stub registry (no DB dependency).
 *
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/crmQueryPlannerService.test.ts
 */

// crmQueryPlannerService transitively imports server/db/index.ts which validates
// env vars via zod. Load .env first so the import does not throw on DATABASE_URL.
// In environments without a .env file (CI, ephemeral sandboxes), fall back to
// placeholder values — this test never hits the DB or signs a JWT.
// ESM static imports are hoisted before any code runs, so we use dynamic imports
// to guarantee env vars are seeded before the service module initialises.
import 'dotenv/config';
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET   ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM   ??= 'test-placeholder@example.com';

import { expect, test } from 'vitest';
import type { RunQueryDeps } from '../crmQueryPlannerService.js';
import type { RunLlmStage3Output } from '../llmPlanner.js';
import type { ExecutorContext, CanonicalQueryRegistry } from '../../../../shared/types/crmQueryPlanner.js';

const { runQuery } = await import('../crmQueryPlannerService.js');


// ── Stub registry (no DB) ─────────────────────────────────────────────────────

const MOCK_ROWS = [{ id: 'c1', displayName: 'Alice' }];

const stubRegistry: CanonicalQueryRegistry = Object.freeze({
  'contacts.inactive_over_days': {
    key:                  'contacts.inactive_over_days',
    primaryEntity:        'contacts',
    aliases:              ['stale contacts', 'contacts no activity'],
    requiredCapabilities: ['canonical.contacts.read'],
    description:          'Contacts with no activity since N days ago',
    allowedFields: {
      updatedAt: { operators: ['lt', 'lte', 'gt', 'gte', 'between'], projectable: true, sortable: true },
      id:        { operators: ['eq', 'in'],                          projectable: true, sortable: false },
    },
    handler: async () => ({
      rows:            MOCK_ROWS,
      rowCount:        1,
      truncated:       false,
      actualCostCents: 0,
      source:          'canonical' as const,
    }),
    parseArgs: (_intent: any) => ({ limit: 100 }),
  },
});

const deps: RunQueryDeps = { registry: stubRegistry };

function makeContext(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    orgId:                'org-1',
    organisationId:       'org-1',
    subaccountId:         'sub-1',
    principalType:        'user',
    principalId:          'user-1',
    teamIds:              [],
    callerCapabilities:   new Set(['crm.query']),
    ...overrides,
  };
}

// Stage 3 stubs — route Stage 3 outcomes without hitting llmRouter / provider.
function stage3Throws(err: unknown): RunQueryDeps['runLlmStage3'] {
  return async () => { throw err; };
}

function stage3Returns(partial: Partial<RunLlmStage3Output>): RunQueryDeps['runLlmStage3'] {
  return async () => ({
    draft: {
      source:                'live',
      intentClass:           'unsupported',
      primaryEntity:         'contacts',
      filters:               [],
      limit:                 50,
      canonicalCandidateKey: null,
      confidence:            0.9,
    } as RunLlmStage3Output['draft'],
    escalated: false,
    ...partial,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Stage 1 hit → structured result
test('registry-matched intent → stageResolved:1 + structured artefact', async () => {
  const output = await runQuery({ rawIntent: 'stale contacts', subaccountId: 'sub-1' }, makeContext(), deps);
  expect(output.stageResolved, 'stageResolved').toBe(1);
  expect(output.artefacts.length > 0, 'must have artefacts').toBeTruthy();
  expect(output.artefacts[0]!.kind, 'first artefact kind').toBe('structured');
});

// intentHash populated
test('output intentHash is a non-empty hex string', async () => {
  const output = await runQuery({ rawIntent: 'stale contacts', subaccountId: 'sub-1' }, makeContext(), deps);
  expect(typeof output.intentHash === 'string' && output.intentHash.length === 16, 'intentHash is 16-char hex').toBeTruthy();
});

// costPreview: Stage 1 canonical is free
test('Stage 1 canonical hit → predictedCostCents:0', async () => {
  const output = await runQuery({ rawIntent: 'contacts no activity', subaccountId: 'sub-1' }, makeContext(), deps);
  expect(output.costPreview.predictedCostCents, 'canonical reads cost 0').toBe(0);
  expect(output.costPreview.confidence, 'Stage 1 confidence is high').toBe('high');
});

// Stage 3 stub that returns intentClass: 'unsupported' → unsupported_query error
test('Stage 3 returns unsupported intentClass → unsupported_query artefact', async () => {
  const output = await runQuery(
    { rawIntent: 'show me the weather forecast', subaccountId: 'sub-1' },
    makeContext(),
    { ...deps, runLlmStage3: stage3Returns({}) },
  );
  expect(output.artefacts.length > 0, 'must have artefacts').toBeTruthy();
  expect(output.artefacts[0]!.kind, 'artefact kind').toBe('error');
  expect((output.artefacts[0] as any).errorCode, 'errorCode').toBe('unsupported_query');
  expect(output.stageResolved, 'Stage 3 path').toBe(3);
});

// Stage 3 throws a plain parse error → ambiguous_intent
test('Stage 3 parse failure → ambiguous_intent artefact', async () => {
  const output = await runQuery(
    { rawIntent: 'something gibberish', subaccountId: 'sub-1' },
    makeContext(),
    { ...deps, runLlmStage3: stage3Throws(new Error('parse failed')) },
  );
  expect(output.artefacts[0]!.kind, 'artefact kind').toBe('error');
  expect((output.artefacts[0] as any).errorCode, 'errorCode').toBe('ambiguous_intent');
});

// Stage 3 throws plain object { statusCode: 402 } → cost_exceeded (B1 coverage)
test('Stage 3 budget exceeded (plain statusCode: 402) → cost_exceeded artefact', async () => {
  const budgetErr = { statusCode: 402, code: 'COMPUTE_BUDGET_EXCEEDED', message: 'over compute budget' };
  const output = await runQuery(
    { rawIntent: 'anything', subaccountId: 'sub-1' },
    makeContext(),
    { ...deps, runLlmStage3: stage3Throws(budgetErr) },
  );
  expect(output.artefacts[0]!.kind, 'artefact kind').toBe('error');
  expect((output.artefacts[0] as any).errorCode, 'errorCode').toBe('cost_exceeded');
});

// Stage 3 throws FailureError with cost_limit_exceeded → cost_exceeded (B1 coverage)
test('Stage 3 budget exceeded (FailureError cost_limit_exceeded) → cost_exceeded artefact', async () => {
  const { FailureError } = await import('../../../../shared/iee/failure.js');
  const failure = new FailureError({
    failureReason: 'internal_error',
    failureDetail: 'cost_limit_exceeded',
  });
  const output = await runQuery(
    { rawIntent: 'anything', subaccountId: 'sub-1' },
    makeContext(),
    { ...deps, runLlmStage3: stage3Throws(failure) },
  );
  expect(output.artefacts[0]!.kind, 'artefact kind').toBe('error');
  expect((output.artefacts[0] as any).errorCode, 'errorCode').toBe('cost_exceeded');
});

// llmRouter also throws `statusCode: 402` with `code: 'RATE_LIMITED'` for
// reservation-side rate-limit rejections (a transient failure, not a compute
// budget overrun). The isComputeBudgetExceededError discriminator must gate on
// `code === 'COMPUTE_BUDGET_EXCEEDED'` so rate-limited 402s fall through to the
// generic parse-failure → ambiguous_intent path rather than being surfaced
// as a final cost_exceeded terminal.
test('Stage 3 rate-limited (statusCode: 402, code: RATE_LIMITED) → ambiguous_intent, not cost_exceeded', async () => {
  const rateLimitErr = { statusCode: 402, code: 'RATE_LIMITED', message: 'reservation rate-limited' };
  const output = await runQuery(
    { rawIntent: 'anything', subaccountId: 'sub-1' },
    makeContext(),
    { ...deps, runLlmStage3: stage3Throws(rateLimitErr) },
  );
  expect(output.artefacts[0]!.kind, 'artefact kind').toBe('error');
  expect((output.artefacts[0] as any).errorCode, 'rate-limited must not map to cost_exceeded').toBe('ambiguous_intent');
});

// forward-looking canonical.* capabilities are skipped — no MissingPermissionError
test('caller without canonical.contacts.read → succeeds (forward-looking skip)', async () => {
  const ctx = makeContext({ callerCapabilities: new Set(['crm.query']) });
  const output = await runQuery({ rawIntent: 'stale contacts', subaccountId: 'sub-1' }, ctx, deps);
  // canonical.contacts.read is forward-looking; executor skips it
  expect(output.artefacts[0]?.kind !== 'error', 'forward-looking cap must not block canonical dispatch').toBeTruthy();
});

// NotImplementedError is Error subclass (kept for P2/P3 use)
test('NotImplementedError extends Error', async () => {
  const { NotImplementedError } = await import('../crmQueryPlannerService.js');
  const e = new NotImplementedError('test message');
  expect(e instanceof Error, 'must be instanceof Error').toBeTruthy();
  expect(e.name, 'name').toBe('NotImplementedError');
  expect(e.message.includes('test message'), 'message preserved').toBeTruthy();
});

// ── Orchestration-level cache tests (round 2 finding #3) ──────────────────────
// Unit tests in planCachePure cover key-shape / TTL / subaccount isolation; these
// tests exercise the service-layer sequence end-to-end (Stage 3 write → Stage 2
// hit; principal mismatch → fallback to Stage 3; Stage 1 hits never populate).

// Stub that produces a valid canonical plan the validator accepts and
// planCache.set persists (stageResolved will be 3 when the LLM path is taken).
function stage3ReturnsCanonical(): RunQueryDeps['runLlmStage3'] {
  return async () => ({
    draft: {
      source:                'canonical',
      intentClass:           'list_entities',
      primaryEntity:         'contacts',
      filters:               [],
      limit:                 50,
      canonicalCandidateKey: 'contacts.inactive_over_days',
      confidence:            0.9,
    } as RunLlmStage3Output['draft'],
    escalated: false,
    // Token usage stubs — the route populates these; zero keeps cost calc trivial.
    defaultTierUsage:    { inputTokens: 0, outputTokens: 0, model: 'x' },
    escalationTierUsage: undefined,
  });
}

// Instrument runLlmStage3 so tests can assert it was (or wasn't) called.
function stage3Counting(inner: NonNullable<RunQueryDeps['runLlmStage3']>): {
  stub: NonNullable<RunQueryDeps['runLlmStage3']>;
  calls: () => number;
} {
  let n = 0;
  return {
    stub:   async (args: any) => { n++; return inner(args); },
    calls:  () => n,
  };
}

test('cache: Stage 3 validated plan is cached → second identical request hits cache (stageResolved:2)', async () => {
  const planCache = await import('../planCache.js');
  planCache._clear();
  const { stub, calls } = stage3Counting(stage3ReturnsCanonical()!);
  const intent = 'bespoke cache test intent aardvark';

  // Request 1: miss → Stage 3 → validated → written to cache → stageResolved:3
  const first = await runQuery(
    { rawIntent: intent, subaccountId: 'sub-1' },
    makeContext(),
    { ...deps, runLlmStage3: stub },
  );
  expect(first.stageResolved, 'first request resolves at Stage 3').toBe(3);
  expect(calls(), 'Stage 3 called exactly once on first request').toBe(1);
  expect(planCache._size() >= 1, 'cache populated after Stage 3 success').toBeTruthy();

  // Request 2: hit → Stage 2 cache → same stub must NOT be called again
  const second = await runQuery(
    { rawIntent: intent, subaccountId: 'sub-1' },
    makeContext(),
    { ...deps, runLlmStage3: stub },
  );
  expect(second.stageResolved, 'second request resolves at Stage 2 via cache').toBe(2);
  expect(calls(), 'Stage 3 NOT called on second (cached) request').toBe(1);
  expect(second.intentHash, 'same intentHash across both calls').toEqual(first.intentHash);
});

test('cache: principal_mismatch falls back to Stage 3 (does not reuse cache for a different caller)', async () => {
  const planCache = await import('../planCache.js');
  planCache._clear();
  const intent = 'principal mismatch scenario wombat';

  // Build a registry that requires a capability NOT held by the second caller,
  // so the cached plan's rule-10 check (capability_check) fails for caller 2.
  // The stub registry's canonical.contacts.read capability is forward-looking
  // and skipped by canonicalExecutor, so it cannot demonstrate the mismatch.
  // Use a non-forward-looking required capability that validatePlanPure's
  // rule-10 enforces against `callerCapabilities`.
  const guardedRegistry = Object.freeze({
    ...stubRegistry,
    'contacts.inactive_over_days': {
      ...stubRegistry['contacts.inactive_over_days']!,
      requiredCapabilities: ['crm.elevated_read'],
    },
  });
  const guardedDeps: RunQueryDeps = { registry: guardedRegistry };

  // Caller 1 holds the capability → Stage 3 succeeds, plan cached.
  const { stub, calls } = stage3Counting(stage3ReturnsCanonical()!);
  const ctx1 = makeContext({ callerCapabilities: new Set(['crm.query', 'crm.elevated_read']) });
  const first = await runQuery(
    { rawIntent: intent, subaccountId: 'sub-1' },
    ctx1,
    { ...guardedDeps, runLlmStage3: stub },
  );
  expect(first.stageResolved, 'caller 1 resolves at Stage 3 and cache is populated').toBe(3);
  expect(calls(), 'Stage 3 invoked for caller 1').toBe(1);

  // Caller 2 lacks the capability → cache lookup hits key, but rule-10 rerun
  // rejects (principal_mismatch) → pipeline falls back to Stage 3 (invoking
  // the stub again, NOT serving the stale cached plan).
  const ctx2 = makeContext({ callerCapabilities: new Set(['crm.query']) });
  const second = await runQuery(
    { rawIntent: intent, subaccountId: 'sub-1' },
    ctx2,
    { ...guardedDeps, runLlmStage3: stub },
  );
  expect(second.stageResolved, 'caller 2 falls back to Stage 3 (not Stage 2)').toBe(3);
  expect(calls(), 'Stage 3 invoked again for caller 2, not cache-reused').toBe(2);
});

test('cache: Stage 1 hits do NOT populate the plan cache', async () => {
  const planCache = await import('../planCache.js');
  planCache._clear();

  const output = await runQuery(
    { rawIntent: 'stale contacts', subaccountId: 'sub-1' },
    makeContext(),
    deps,
  );
  expect(output.stageResolved, 'sanity — intent resolves at Stage 1').toBe(1);
  expect(planCache._size(), 'Stage 1 hits MUST NOT populate the plan cache (spec §9.3)').toBe(0);
});

