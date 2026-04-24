/**
 * approvalCardGeneratorPure.test.ts — spec §15.5
 *
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/approvalCardGeneratorPure.test.ts
 */
import { generateApprovalCards } from '../approvalCardGeneratorPure.js';
import type { ApprovalCardContext } from '../approvalCardGeneratorPure.js';
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
  assertEqual(cards.length, 1, 'one card');
  assertEqual(cards[0]!.kind, 'approval', 'kind=approval');
  assertEqual(cards[0]!.actionSlug, 'crm.send_email', 'actionSlug=crm.send_email');
  assertEqual((cards[0]!.actionArgs as any).toContactId, 'c1', 'toContactId');
  assertEqual((cards[0]!.actionArgs as any).from, 'sender@example.com', 'from');
});

test('contact-list with 0 rows → no card', () => {
  const cards = generateApprovalCards(makePlan(), makeExec({ rows: [], rowCount: 0 }), ctx);
  assertEqual(cards.length, 0, 'no card for empty result');
});

test('opportunity-list → no card in v1', () => {
  const plan = makePlan({ primaryEntity: 'opportunities' });
  const cards = generateApprovalCards(plan, makeExec({ rows: [{ id: 'o1' }], rowCount: 1 }), ctx);
  assertEqual(cards.length, 0, 'v1 has no opportunity card');
});

test('missing defaultSenderIdentifier → no card (graceful skip)', () => {
  const noSenderCtx: ApprovalCardContext = { subaccountId: 'sub-1' };
  const cards = generateApprovalCards(makePlan(), makeExec({ rows: [{ id: 'c1' }], rowCount: 1 }), noSenderCtx);
  assertEqual(cards.length, 0, 'no sender → no card');
});

test('approval card affectedRecordIds contains the top-row id', () => {
  const cards = generateApprovalCards(makePlan(), makeExec({ rows: [{ id: 'c99' }], rowCount: 1 }), ctx);
  assert(cards[0]!.affectedRecordIds.includes('c99'), 'affectedRecordIds must include contact id');
});

test('approval card riskLevel is always low for single-contact email (v1)', () => {
  const cards = generateApprovalCards(makePlan(), makeExec({ rows: [{ id: 'c1' }], rowCount: 1 }), ctx);
  assertEqual(cards[0]!.riskLevel, 'low', 'single-contact email is always low risk');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
