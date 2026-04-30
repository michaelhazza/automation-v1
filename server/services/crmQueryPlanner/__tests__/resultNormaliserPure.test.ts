/**
 * resultNormaliserPure.test.ts — spec §15.5
 *
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/resultNormaliserPure.test.ts
 */
import { expect, test } from 'vitest';
import {
  buildStructuredResult,
  generateApprovalCards,
  generateSuggestions,
  normaliseToArtefacts,
} from '../resultNormaliserPure.js';
import type { NormaliserContext } from '../resultNormaliserPure.js';
import type { QueryPlan, ExecutorResult } from '../../../../shared/types/crmQueryPlanner.js';

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
  expect(result.kind, 'kind').toBe('structured');
});

test('structured result has artefactId (non-empty string)', () => {
  const result = buildStructuredResult(makePlan(), makeExecResult());
  expect(typeof result.artefactId === 'string' && result.artefactId.length > 0, 'artefactId must be non-empty').toBeTruthy();
});

test('structured result entityType matches plan.primaryEntity', () => {
  const plan = makePlan({ primaryEntity: 'opportunities' });
  const result = buildStructuredResult(plan, makeExecResult());
  expect(result.entityType, 'entityType').toBe('opportunities');
});

test('structured result rowCount propagates', () => {
  const execResult = makeExecResult({ rowCount: 42, rows: Array(42).fill({ id: '1' }) });
  const result = buildStructuredResult(makePlan(), execResult);
  expect(result.rowCount, 'rowCount').toBe(42);
});

test('structured result truncated propagates', () => {
  const execResult = makeExecResult({ truncated: true, truncationReason: 'result_limit' });
  const result = buildStructuredResult(makePlan(), execResult);
  expect(result.truncated, 'truncated').toBe(true);
  expect(result.truncationReason, 'truncationReason').toBe('result_limit');
});

test('structured result truncated=false propagates', () => {
  const result = buildStructuredResult(makePlan(), makeExecResult({ truncated: false }));
  expect(result.truncated, 'truncated').toBe(false);
});

test('structured result costCents from execResult', () => {
  const result = buildStructuredResult(makePlan(), makeExecResult({ actualCostCents: 5 }));
  expect(result.costCents, 'costCents').toBe(5);
});

test('structured result source from execResult', () => {
  const result = buildStructuredResult(makePlan(), makeExecResult({ source: 'live' }));
  expect(result.source, 'source').toBe('live');
});

test('structured result filtersApplied matches plan filters', () => {
  const plan = makePlan({
    filters: [
      { field: 'updatedAt', operator: 'lt', value: 30, humanLabel: 'Updated more than 30 days ago' },
    ],
  });
  const result = buildStructuredResult(plan, makeExecResult());
  expect(result.filtersApplied.length, 'filtersApplied length').toBe(1);
  expect(result.filtersApplied[0]!.field, 'filter field').toBe('updatedAt');
  expect(result.filtersApplied[0]!.humanLabel, 'filter humanLabel').toBe('Updated more than 30 days ago');
});

test('filtersApplied ne operator maps to neq on wire', () => {
  const plan = makePlan({
    filters: [{ field: 'stage', operator: 'ne', value: 'closed', humanLabel: 'Stage not closed' }],
  });
  const result = buildStructuredResult(plan, makeExecResult());
  expect(result.filtersApplied[0]!.operator, 'ne→neq').toBe('neq');
});

test('filtersApplied is_null operator maps to exists=false on wire', () => {
  const plan = makePlan({
    filters: [{ field: 'email', operator: 'is_null', value: null, humanLabel: 'Email is missing' }],
  });
  const result = buildStructuredResult(plan, makeExecResult());
  expect(result.filtersApplied[0]!.operator, 'is_null→exists').toBe('exists');
  expect(result.filtersApplied[0]!.value, 'is_null value=false').toBe(false);
});

test('filtersApplied is_not_null operator maps to exists=true on wire', () => {
  const plan = makePlan({
    filters: [{ field: 'phone', operator: 'is_not_null', value: null, humanLabel: 'Phone is present' }],
  });
  const result = buildStructuredResult(plan, makeExecResult());
  expect(result.filtersApplied[0]!.operator, 'is_not_null→exists').toBe('exists');
  expect(result.filtersApplied[0]!.value, 'is_not_null value=true').toBe(true);
});

test('structured result suggestions is an array', () => {
  const result = buildStructuredResult(makePlan(), makeExecResult());
  expect(Array.isArray(result.suggestions), 'suggestions must be array').toBeTruthy();
});

// ── generateSuggestions ───────────────────────────────────────────────────────

test('truncated result includes narrow suggestion', () => {
  const exec = makeExecResult({ truncated: true });
  const suggestions = generateSuggestions(makePlan(), exec);
  expect(suggestions.some(s => s.kind === 'narrow'), 'should have narrow suggestion on truncation').toBeTruthy();
});

test('rowCount > 50 includes sort suggestion', () => {
  const exec = makeExecResult({ rowCount: 51 });
  const suggestions = generateSuggestions(makePlan(), exec);
  expect(suggestions.some(s => s.kind === 'sort'), 'should have sort suggestion for large results').toBeTruthy();
});

test('contact result with rows includes action suggestion', () => {
  const exec = makeExecResult({ rows: [{ id: 'c1', displayName: 'Alice' }], rowCount: 1 });
  const suggestions = generateSuggestions(makePlan({ primaryEntity: 'contacts' }), exec);
  expect(suggestions.some(s => s.kind === 'action'), 'contacts with rows should have action suggestion').toBeTruthy();
});

test('non-contact result with rows has no action suggestion', () => {
  const exec = makeExecResult({ rows: [{ id: 'o1' }], rowCount: 1 });
  const suggestions = generateSuggestions(makePlan({ primaryEntity: 'opportunities' }), exec);
  expect(!suggestions.some(s => s.kind === 'action'), 'opportunities should not have email action in v1').toBeTruthy();
});

// ── generateApprovalCards ─────────────────────────────────────────────────────

test('contact-list with ≥1 row → approval card for top row', () => {
  const plan = makePlan({ primaryEntity: 'contacts' });
  const exec = makeExecResult({ rows: [{ id: 'c1', displayName: 'Alice' }], rowCount: 1 });
  const cards = generateApprovalCards(plan, exec, defaultContext);
  expect(cards.length, 'should emit 1 card').toBe(1);
  expect(cards[0]!.kind, 'kind').toBe('approval');
  expect(cards[0]!.actionSlug, 'actionSlug').toBe('crm.send_email');
  expect((cards[0]!.actionArgs as any).toContactId, 'toContactId').toBe('c1');
  expect((cards[0]!.actionArgs as any).from, 'from').toBe('sender@example.com');
});

test('contact-list with 0 rows → no card', () => {
  const plan = makePlan({ primaryEntity: 'contacts' });
  const exec = makeExecResult({ rows: [], rowCount: 0 });
  const cards = generateApprovalCards(plan, exec, defaultContext);
  expect(cards.length, 'no rows → no card').toBe(0);
});

test('opportunity-list → no card in v1', () => {
  const plan = makePlan({ primaryEntity: 'opportunities' });
  const exec = makeExecResult({ rows: [{ id: 'o1' }], rowCount: 1 });
  const cards = generateApprovalCards(plan, exec, defaultContext);
  expect(cards.length, 'opportunities → no v1 card').toBe(0);
});

test('missing defaultSenderIdentifier → no card', () => {
  const plan = makePlan({ primaryEntity: 'contacts' });
  const exec = makeExecResult({ rows: [{ id: 'c1' }], rowCount: 1 });
  const ctx: NormaliserContext = { subaccountId: 'sub-1' }; // no defaultSenderIdentifier
  const cards = generateApprovalCards(plan, exec, ctx);
  expect(cards.length, 'no sender → no card').toBe(0);
});

test('approval card affectedRecordIds contains top-row id', () => {
  const plan = makePlan({ primaryEntity: 'contacts' });
  const exec = makeExecResult({ rows: [{ id: 'c99' }], rowCount: 1 });
  const cards = generateApprovalCards(plan, exec, defaultContext);
  expect(cards[0]!.affectedRecordIds.includes('c99'), 'affectedRecordIds must include contact id').toBeTruthy();
});

test('approval card riskLevel is low', () => {
  const plan = makePlan({ primaryEntity: 'contacts' });
  const exec = makeExecResult({ rows: [{ id: 'c1' }], rowCount: 1 });
  const cards = generateApprovalCards(plan, exec, defaultContext);
  expect(cards[0]!.riskLevel, 'single-contact email risk is always low').toBe('low');
});

// ── normaliseToArtefacts ──────────────────────────────────────────────────────

test('normaliseToArtefacts returns structured + approvalCards', () => {
  const plan = makePlan({ primaryEntity: 'contacts' });
  const exec = makeExecResult({ rows: [{ id: 'c1', displayName: 'Bob' }], rowCount: 1 });
  const result = normaliseToArtefacts(plan, exec, defaultContext);
  expect('structured' in result, 'must have structured').toBeTruthy();
  expect('approvalCards' in result, 'must have approvalCards').toBeTruthy();
  expect(result.structured.kind, 'structured.kind').toBe('structured');
  expect(result.approvalCards.length, 'one approval card for contacts with rows').toBe(1);
});

test('normaliseToArtefacts for live source propagates source', () => {
  const plan = makePlan({ source: 'live' as const, canonicalCandidateKey: null });
  const exec = makeExecResult({ source: 'live', rows: [] });
  const result = normaliseToArtefacts(plan, exec, defaultContext);
  expect(result.structured.source, 'source=live propagates').toBe('live');
});

test('normaliseToArtefacts for hybrid source propagates source', () => {
  const plan = makePlan({ source: 'hybrid' as const });
  const exec = makeExecResult({ source: 'hybrid', rows: [] });
  const result = normaliseToArtefacts(plan, exec, defaultContext);
  expect(result.structured.source, 'source=hybrid propagates').toBe('hybrid');
});

// ── Summary ───────────────────────────────────────────────────────────────────
