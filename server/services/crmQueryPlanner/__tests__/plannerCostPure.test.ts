/**
 * plannerCostPure.test.ts — spec §16.2.1
 * 6 cases: Stage3-only / escalation / live-call count / hybrid / actual vs predicted / zero inputs
 *
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/plannerCostPure.test.ts
 */
import { computePlannerCostPreview, computeActualCostCents } from '../plannerCostPure.js';

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

// ── Zero inputs ───────────────────────────────────────────────────────────────

test('zero inputs → zero cost, high confidence, static_heuristic', () => {
  const preview = computePlannerCostPreview({});
  assertEqual(preview.predictedCostCents, 0, 'predictedCostCents');
  assertEqual(preview.confidence, 'high', 'confidence');
  assertEqual(preview.basedOn, 'static_heuristic', 'basedOn');
});

test('zero inputs actual → { total:0, stage3:0, executor:0 }', () => {
  const actual = computeActualCostCents({});
  assertEqual(actual, { total: 0, stage3: 0, executor: 0 }, 'all zeros');
});

// ── Stage 3 only ──────────────────────────────────────────────────────────────

test('Stage 3 parse only → medium confidence, planner_estimate', () => {
  // Use large enough token counts to produce nonzero rounded cents
  const preview = computePlannerCostPreview({
    stage3ParseUsage: { inputTokens: 100_000, outputTokens: 20_000, model: 'claude-haiku-4-5' },
  });
  assertEqual(preview.confidence, 'medium', 'confidence degrades to medium with Stage 3');
  assertEqual(preview.basedOn, 'planner_estimate', 'basedOn');
  assert(preview.predictedCostCents > 0, 'cost > 0 for non-trivial token usage');
});

// ── Escalation ────────────────────────────────────────────────────────────────

test('escalation adds to Stage 3 cost and drops confidence to low', () => {
  const preview = computePlannerCostPreview({
    stage3ParseUsage:      { inputTokens: 1_000, outputTokens: 200, model: 'claude-haiku-4-5' },
    stage3EscalationUsage: { inputTokens: 2_000, outputTokens: 400, model: 'claude-sonnet-4-6' },
  });
  assertEqual(preview.confidence, 'low', 'confidence is low after escalation');
  assert(preview.predictedCostCents > 0, 'escalation adds cost');

  const actual = computeActualCostCents({
    stage3ParseUsage:      { inputTokens: 1_000, outputTokens: 200, model: 'claude-haiku-4-5' },
    stage3EscalationUsage: { inputTokens: 2_000, outputTokens: 400, model: 'claude-sonnet-4-6' },
  });
  assert(actual.stage3 > 0, 'stage3 cost positive after escalation');
  assertEqual(actual.executor, 0, 'executor=0 (no live calls)');
  assertEqual(actual.total, actual.stage3, 'total = stage3 when no live calls');
});

// ── Live-call count ───────────────────────────────────────────────────────────

test('live call count does not inflate total in v1 (live calls cost 0 cents)', () => {
  const actual = computeActualCostCents({ liveCallCount: 10 });
  assertEqual(actual.executor, 0, 'executor=0 (live cost is 0 in v1 pricing)');
  assertEqual(actual.total, 0, 'total=0 with only live calls');
});

// ── Actual vs predicted split ─────────────────────────────────────────────────

test('actualCostCents preserves stage3 / executor split', () => {
  const actual = computeActualCostCents({
    stage3ParseUsage: { inputTokens: 100_000, outputTokens: 10_000, model: 'claude-sonnet-4-6' },
    liveCallCount:    5,
  });
  assert(actual.stage3 > 0, 'stage3 > 0');
  assertEqual(actual.executor, 0, 'executor=0 for live in v1');
  assertEqual(actual.total, actual.stage3 + actual.executor, 'total = stage3 + executor');
});

// ── Hybrid live calls ──────────────────────────────────────────────────────────

test('hybrid live call count treated same as live (0 cents in v1)', () => {
  const actual = computeActualCostCents({ hybridLiveCallCount: 3 });
  assertEqual(actual.executor, 0, 'hybrid live calls cost 0 in v1 pricing');
  assertEqual(actual.total, 0, 'total=0');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
