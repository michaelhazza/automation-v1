/**
 * approvalCardGeneratorPure.test.ts — spec §15.5
 *
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/approvalCardGeneratorPure.test.ts
 */
import { expect, test } from 'vitest';
import { generateApprovalCards } from '../approvalCardGeneratorPure.js';
import type { ApprovalCardContext } from '../approvalCardGeneratorPure.js';
import type { QueryPlan, ExecutorResult } from '../../../../shared/types/crmQueryPlanner.js';

function assertEqual<T>(a: T, b: T, label = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePlan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    source: 'canonical', intentClass: 'list_entities', primaryEntity: 'contacts',
    filters: [], limit: 100, canonicalCandidateKey: 'contacts.inactive_over_days',
    confidence: 1.0, stageResolved: 1,
    costPreview: { predictedCostCents: 0, confidence: 'high', basedOn: 'static_heuristic' },
    validated: true, ...overrides,
  };
}

function makeExec(overrides: Partial<ExecutorResult> = {}): ExecutorResult {
  return { rows: [], rowCount: 0, truncated: false, actualCostCents: 0, source: 'canonical', ...overrides };
}

const ctx: ApprovalCardContext = {
  subaccountId: 'sub-1',
  defaultSenderIdentifier: 'sender@example.com',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

test('contact-list with ≥1 row → single approval card for top row', () => {
  const cards = generateApprovalCards(makePlan(), makeExec({ rows: [{ id: 'c1', displayName: 'Alice' }], rowCount: 1 }), ctx);
  expect(cards.length, 'one card').toBe(1);
  expect(cards[0]!.kind, 'kind=approval').toBe('approval');
  expect(cards[0]!.actionSlug, 'actionSlug=crm.send_email').toBe('crm.send_email');
  expect((cards[0]!.actionArgs as any).toContactId, 'toContactId').toBe('c1');
  expect((cards[0]!.actionArgs as any).from, 'from').toBe('sender@example.com');
});

test('contact-list with 0 rows → no card', () => {
  const cards = generateApprovalCards(makePlan(), makeExec({ rows: [], rowCount: 0 }), ctx);
  expect(cards.length, 'no card for empty result').toBe(0);
});

test('opportunity-list → no card in v1', () => {
  const plan = makePlan({ primaryEntity: 'opportunities' });
  const cards = generateApprovalCards(plan, makeExec({ rows: [{ id: 'o1' }], rowCount: 1 }), ctx);
  expect(cards.length, 'v1 has no opportunity card').toBe(0);
});

test('missing defaultSenderIdentifier → no card (graceful skip)', () => {
  const noSenderCtx: ApprovalCardContext = { subaccountId: 'sub-1' };
  const cards = generateApprovalCards(makePlan(), makeExec({ rows: [{ id: 'c1' }], rowCount: 1 }), noSenderCtx);
  expect(cards.length, 'no sender → no card').toBe(0);
});

test('approval card affectedRecordIds contains the top-row id', () => {
  const cards = generateApprovalCards(makePlan(), makeExec({ rows: [{ id: 'c99' }], rowCount: 1 }), ctx);
  expect(cards[0]!.affectedRecordIds.includes('c99'), 'affectedRecordIds must include contact id').toBeTruthy();
});

test('approval card riskLevel is always low for single-contact email (v1)', () => {
  const cards = generateApprovalCards(makePlan(), makeExec({ rows: [{ id: 'c1' }], rowCount: 1 }), ctx);
  expect(cards[0]!.riskLevel, 'single-contact email is always low risk').toBe('low');
});

// ── Summary ───────────────────────────────────────────────────────────────────
