/**
 * resultNormaliserPure.test.ts — spec §15.5
 *
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/resultNormaliserPure.test.ts
 */
import {
  buildStructuredResult,
  generateApprovalCards,
  generateSuggestions,
  normaliseToArtefacts,
} from '../resultNormaliserPure.js';
import type { NormaliserContext } from '../resultNormaliserPure.js';
import type { QueryPlan, ExecutorResult } from '../../../../shared/types/crmQueryPlanner.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(label);
}

function assertEqual<T>(a: T, b: T, label = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePlan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    source: 'canonical',
    intentClass: 'list_entities',
    primaryEntity: 'contacts',
    filters: [],
    limit: 100,
    canonicalCandidateKey: 'contacts.inactive_over_days',
    confidence: 1.0,
    stageResolved: 1,
    costPreview: { predictedCostCents: 0, confidence: 'high', basedOn: 'static_heuristic' },
    validated: true,
    ...overrides,
  };
}

function makeExecResult(overrides: Partial<ExecutorResult> = {}): ExecutorResult {
  return {
    rows: [],
    rowCount: 0,
    truncated: false,
    actualCostCents: 0,
    source: 'canonical',
    ...overrides,
  };
}

const defaultContext: NormaliserContext = {
  subaccountId: 'sub-1',
  defaultSenderIdentifier: 'sender@example.com',
};

// ── buildStructuredResult ─────────────────────────────────────────────────────

test('structured result has kind=structured', () => {
  const result = buildStructuredResult(makePlan(), makeExecResult());
  assertEqual(result.kind, 'structured', 'kind');
});

test('structured result has artefactId (non-empty string)', () => {
  const result = buildStructuredResult(makePlan(), makeExecResult());
  assert(typeof result.artefactId === 'string' && result.artefactId.length > 0, 'artefactId must be non-empty');
});

test('structured result entityType matches plan.primaryEntity', () => {
  const plan = makePlan({ primaryEntity: 'opportunities' });
  const result = buildStructuredResult(plan, makeExecResult());
  assertEqual(result.entityType, 'opportunities', 'entityType');
});

test('structured result rowCount propagates', () => {
  const execResult = makeExecResult({ rowCount: 42, rows: Array(42).fill({ id: '1' }) });
  const result = buildStructuredResult(makePlan(), execResult);
  assertEqual(result.rowCount, 42, 'rowCount');
});

test('structured result truncated propagates', () => {
  const execResult = makeExecResult({ truncated: true, truncationReason: 'result_limit' });
  const result = buildStructuredResult(makePlan(), execResult);
  assertEqual(result.truncated, true, 'truncated');
  assertEqual(result.truncationReason, 'result_limit', 'truncationReason');
});

test('structured result truncated=false propagates', () => {
  const result = buildStructuredResult(makePlan(), makeExecResult({ truncated: false }));
  assertEqual(result.truncated, false, 'truncated');
});

test('structured result costCents from execResult', () => {
  const result = buildStructuredResult(makePlan(), makeExecResult({ actualCostCents: 5 }));
  assertEqual(result.costCents, 5, 'costCents');
});

test('structured result source from execResult', () => {
  const result = buildStructuredResult(makePlan(), makeExecResult({ source: 'live' }));
  assertEqual(result.source, 'live', 'source');
});

test('structured result filtersApplied matches plan filters', () => {
  const plan = makePlan({
    filters: [
      { field: 'updatedAt', operator: 'lt', value: 30, humanLabel: 'Updated more than 30 days ago' },
    ],
  });
  const result = buildStructuredResult(plan, makeExecResult());
  assertEqual(result.filtersApplied.length, 1, 'filtersApplied length');
  assertEqual(result.filtersApplied[0]!.field, 'updatedAt', 'filter field');
  assertEqual(result.filtersApplied[0]!.humanLabel, 'Updated more than 30 days ago', 'filter humanLabel');
});

test('filtersApplied ne operator maps to neq on wire', () => {
  const plan = makePlan({
    filters: [{ field: 'stage', operator: 'ne', value: 'closed', humanLabel: 'Stage not closed' }],
  });
  const result = buildStructuredResult(plan, makeExecResult());
  assertEqual(result.filtersApplied[0]!.operator, 'neq', 'ne→neq');
});

test('filtersApplied is_null operator maps to exists=false on wire', () => {
  const plan = makePlan({
    filters: [{ field: 'email', operator: 'is_null', value: null, humanLabel: 'Email is missing' }],
  });
  const result = buildStructuredResult(plan, makeExecResult());
  assertEqual(result.filtersApplied[0]!.operator, 'exists', 'is_null→exists');
  assertEqual(result.filtersApplied[0]!.value, false, 'is_null value=false');
});

test('filtersApplied is_not_null operator maps to exists=true on wire', () => {
  const plan = makePlan({
    filters: [{ field: 'phone', operator: 'is_not_null', value: null, humanLabel: 'Phone is present' }],
  });
  const result = buildStructuredResult(plan, makeExecResult());
  assertEqual(result.filtersApplied[0]!.operator, 'exists', 'is_not_null→exists');
  assertEqual(result.filtersApplied[0]!.value, true, 'is_not_null value=true');
});

test('structured result suggestions is an array', () => {
  const result = buildStructuredResult(makePlan(), makeExecResult());
  assert(Array.isArray(result.suggestions), 'suggestions must be array');
});

// ── generateSuggestions ───────────────────────────────────────────────────────

test('truncated result includes narrow suggestion', () => {
  const exec = makeExecResult({ truncated: true });
  const suggestions = generateSuggestions(makePlan(), exec);
  assert(suggestions.some(s => s.kind === 'narrow'), 'should have narrow suggestion on truncation');
});

test('rowCount > 50 includes sort suggestion', () => {
  const exec = makeExecResult({ rowCount: 51 });
  const suggestions = generateSuggestions(makePlan(), exec);
  assert(suggestions.some(s => s.kind === 'sort'), 'should have sort suggestion for large results');
});

test('contact result with rows includes action suggestion', () => {
  const exec = makeExecResult({ rows: [{ id: 'c1', displayName: 'Alice' }], rowCount: 1 });
  const suggestions = generateSuggestions(makePlan({ primaryEntity: 'contacts' }), exec);
  assert(suggestions.some(s => s.kind === 'action'), 'contacts with rows should have action suggestion');
});

test('non-contact result with rows has no action suggestion', () => {
  const exec = makeExecResult({ rows: [{ id: 'o1' }], rowCount: 1 });
  const suggestions = generateSuggestions(makePlan({ primaryEntity: 'opportunities' }), exec);
  assert(!suggestions.some(s => s.kind === 'action'), 'opportunities should not have email action in v1');
});

// ── generateApprovalCards ─────────────────────────────────────────────────────

test('contact-list with ≥1 row → approval card for top row', () => {
  const plan = makePlan({ primaryEntity: 'contacts' });
  const exec = makeExecResult({ rows: [{ id: 'c1', displayName: 'Alice' }], rowCount: 1 });
  const cards = generateApprovalCards(plan, exec, defaultContext);
  assertEqual(cards.length, 1, 'should emit 1 card');
  assertEqual(cards[0]!.kind, 'approval', 'kind');
  assertEqual(cards[0]!.actionSlug, 'crm.send_email', 'actionSlug');
  assertEqual((cards[0]!.actionArgs as any).toContactId, 'c1', 'toContactId');
  assertEqual((cards[0]!.actionArgs as any).from, 'sender@example.com', 'from');
});

test('contact-list with 0 rows → no card', () => {
  const plan = makePlan({ primaryEntity: 'contacts' });
  const exec = makeExecResult({ rows: [], rowCount: 0 });
  const cards = generateApprovalCards(plan, exec, defaultContext);
  assertEqual(cards.length, 0, 'no rows → no card');
});

test('opportunity-list → no card in v1', () => {
  const plan = makePlan({ primaryEntity: 'opportunities' });
  const exec = makeExecResult({ rows: [{ id: 'o1' }], rowCount: 1 });
  const cards = generateApprovalCards(plan, exec, defaultContext);
  assertEqual(cards.length, 0, 'opportunities → no v1 card');
});

test('missing defaultSenderIdentifier → no card', () => {
  const plan = makePlan({ primaryEntity: 'contacts' });
  const exec = makeExecResult({ rows: [{ id: 'c1' }], rowCount: 1 });
  const ctx: NormaliserContext = { subaccountId: 'sub-1' }; // no defaultSenderIdentifier
  const cards = generateApprovalCards(plan, exec, ctx);
  assertEqual(cards.length, 0, 'no sender → no card');
});

test('approval card affectedRecordIds contains top-row id', () => {
  const plan = makePlan({ primaryEntity: 'contacts' });
  const exec = makeExecResult({ rows: [{ id: 'c99' }], rowCount: 1 });
  const cards = generateApprovalCards(plan, exec, defaultContext);
  assert(cards[0]!.affectedRecordIds.includes('c99'), 'affectedRecordIds must include contact id');
});

test('approval card riskLevel is low', () => {
  const plan = makePlan({ primaryEntity: 'contacts' });
  const exec = makeExecResult({ rows: [{ id: 'c1' }], rowCount: 1 });
  const cards = generateApprovalCards(plan, exec, defaultContext);
  assertEqual(cards[0]!.riskLevel, 'low', 'single-contact email risk is always low');
});

// ── normaliseToArtefacts ──────────────────────────────────────────────────────

test('normaliseToArtefacts returns structured + approvalCards', () => {
  const plan = makePlan({ primaryEntity: 'contacts' });
  const exec = makeExecResult({ rows: [{ id: 'c1', displayName: 'Bob' }], rowCount: 1 });
  const result = normaliseToArtefacts(plan, exec, defaultContext);
  assert('structured' in result, 'must have structured');
  assert('approvalCards' in result, 'must have approvalCards');
  assertEqual(result.structured.kind, 'structured', 'structured.kind');
  assertEqual(result.approvalCards.length, 1, 'one approval card for contacts with rows');
});

test('normaliseToArtefacts for live source propagates source', () => {
  const plan = makePlan({ source: 'live' as const, canonicalCandidateKey: null });
  const exec = makeExecResult({ source: 'live', rows: [] });
  const result = normaliseToArtefacts(plan, exec, defaultContext);
  assertEqual(result.structured.source, 'live', 'source=live propagates');
});

test('normaliseToArtefacts for hybrid source propagates source', () => {
  const plan = makePlan({ source: 'hybrid' as const });
  const exec = makeExecResult({ source: 'hybrid', rows: [] });
  const result = normaliseToArtefacts(plan, exec, defaultContext);
  assertEqual(result.structured.source, 'hybrid', 'source=hybrid propagates');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
