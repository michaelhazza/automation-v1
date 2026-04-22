/**
 * crmQueryPlannerService.test.ts — spec §20.2
 * Orchestration tests with injected stub registry (no DB dependency).
 *
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/crmQueryPlannerService.test.ts
 */
import { runQuery } from '../crmQueryPlannerService.js';
import type { RunQueryDeps } from '../crmQueryPlannerService.js';
import type { RunLlmStage3Output } from '../llmPlanner.js';
import type { ExecutorContext, CanonicalQueryRegistry } from '../../../../shared/types/crmQueryPlanner.js';

let passed = 0;
let failed = 0;
const promises: Promise<void>[] = [];

function test(name: string, fn: () => Promise<void>) {
  promises.push(
    fn().then(
      () => { passed++; console.log(`  PASS  ${name}`); },
      (err) => { failed++; console.log(`  FAIL  ${name}`); console.log(`        ${err instanceof Error ? err.message : err}`); },
    )
  );
}

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(label);
}

function assertEqual<T>(a: T, b: T, label = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

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
  assertEqual(output.stageResolved, 1, 'stageResolved');
  assert(output.artefacts.length > 0, 'must have artefacts');
  assertEqual(output.artefacts[0]!.kind, 'structured', 'first artefact kind');
});

// intentHash populated
test('output intentHash is a non-empty hex string', async () => {
  const output = await runQuery({ rawIntent: 'stale contacts', subaccountId: 'sub-1' }, makeContext(), deps);
  assert(typeof output.intentHash === 'string' && output.intentHash.length === 16, 'intentHash is 16-char hex');
});

// costPreview: Stage 1 canonical is free
test('Stage 1 canonical hit → predictedCostCents:0', async () => {
  const output = await runQuery({ rawIntent: 'contacts no activity', subaccountId: 'sub-1' }, makeContext(), deps);
  assertEqual(output.costPreview.predictedCostCents, 0, 'canonical reads cost 0');
  assertEqual(output.costPreview.confidence, 'high', 'Stage 1 confidence is high');
});

// Stage 3 stub that returns intentClass: 'unsupported' → unsupported_query error
test('Stage 3 returns unsupported intentClass → unsupported_query artefact', async () => {
  const output = await runQuery(
    { rawIntent: 'show me the weather forecast', subaccountId: 'sub-1' },
    makeContext(),
    { ...deps, runLlmStage3: stage3Returns({}) },
  );
  assert(output.artefacts.length > 0, 'must have artefacts');
  assertEqual(output.artefacts[0]!.kind, 'error', 'artefact kind');
  assertEqual((output.artefacts[0] as any).errorCode, 'unsupported_query', 'errorCode');
  assertEqual(output.stageResolved, 3, 'Stage 3 path');
});

// Stage 3 throws a plain parse error → ambiguous_intent
test('Stage 3 parse failure → ambiguous_intent artefact', async () => {
  const output = await runQuery(
    { rawIntent: 'something gibberish', subaccountId: 'sub-1' },
    makeContext(),
    { ...deps, runLlmStage3: stage3Throws(new Error('parse failed')) },
  );
  assertEqual(output.artefacts[0]!.kind, 'error', 'artefact kind');
  assertEqual((output.artefacts[0] as any).errorCode, 'ambiguous_intent', 'errorCode');
});

// Stage 3 throws plain object { statusCode: 402 } → cost_exceeded (B1 coverage)
test('Stage 3 budget exceeded (plain statusCode: 402) → cost_exceeded artefact', async () => {
  const budgetErr = { statusCode: 402, code: 'BUDGET_EXCEEDED', message: 'over budget' };
  const output = await runQuery(
    { rawIntent: 'anything', subaccountId: 'sub-1' },
    makeContext(),
    { ...deps, runLlmStage3: stage3Throws(budgetErr) },
  );
  assertEqual(output.artefacts[0]!.kind, 'error', 'artefact kind');
  assertEqual((output.artefacts[0] as any).errorCode, 'cost_exceeded', 'errorCode');
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
  assertEqual(output.artefacts[0]!.kind, 'error', 'artefact kind');
  assertEqual((output.artefacts[0] as any).errorCode, 'cost_exceeded', 'errorCode');
});

// llmRouter also throws `statusCode: 402` with `code: 'RATE_LIMITED'` for
// reservation-side rate-limit rejections (a transient failure, not a budget
// overrun). The isBudgetExceededError discriminator must gate on
// `code === 'BUDGET_EXCEEDED'` so rate-limited 402s fall through to the
// generic parse-failure → ambiguous_intent path rather than being surfaced
// as a final cost_exceeded terminal.
test('Stage 3 rate-limited (statusCode: 402, code: RATE_LIMITED) → ambiguous_intent, not cost_exceeded', async () => {
  const rateLimitErr = { statusCode: 402, code: 'RATE_LIMITED', message: 'reservation rate-limited' };
  const output = await runQuery(
    { rawIntent: 'anything', subaccountId: 'sub-1' },
    makeContext(),
    { ...deps, runLlmStage3: stage3Throws(rateLimitErr) },
  );
  assertEqual(output.artefacts[0]!.kind, 'error', 'artefact kind');
  assertEqual((output.artefacts[0] as any).errorCode, 'ambiguous_intent', 'rate-limited must not map to cost_exceeded');
});

// forward-looking canonical.* capabilities are skipped — no MissingPermissionError
test('caller without canonical.contacts.read → succeeds (forward-looking skip)', async () => {
  const ctx = makeContext({ callerCapabilities: new Set(['crm.query']) });
  const output = await runQuery({ rawIntent: 'stale contacts', subaccountId: 'sub-1' }, ctx, deps);
  // canonical.contacts.read is forward-looking; executor skips it
  assert(output.artefacts[0]?.kind !== 'error', 'forward-looking cap must not block canonical dispatch');
});

// NotImplementedError is Error subclass (kept for P2/P3 use)
test('NotImplementedError extends Error', async () => {
  const { NotImplementedError } = await import('../crmQueryPlannerService.js');
  const e = new NotImplementedError('test message');
  assert(e instanceof Error, 'must be instanceof Error');
  assertEqual(e.name, 'NotImplementedError', 'name');
  assert(e.message.includes('test message'), 'message preserved');
});

// ── Wait for all async tests ──────────────────────────────────────────────────

await Promise.all(promises);
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
