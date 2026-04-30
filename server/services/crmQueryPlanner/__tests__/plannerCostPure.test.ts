/**
 * plannerCostPure.test.ts — spec §16.2.1
 * 6 cases: Stage3-only / escalation / live-call count / hybrid / actual vs predicted / zero inputs
 *
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/plannerCostPure.test.ts
 */
import { expect, test } from 'vitest';
import { computePlannerCostPreview, computeActualCostCents } from '../plannerCostPure.js';

function assertEqual<T>(a: T, b: T, label = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

// ── Zero inputs ───────────────────────────────────────────────────────────────

test('zero inputs → zero cost, high confidence, static_heuristic', () => {
  const preview = computePlannerCostPreview({});
  expect(preview.predictedCostCents, 'predictedCostCents').toBe(0);
  expect(preview.confidence, 'confidence').toBe('high');
  expect(preview.basedOn, 'basedOn').toBe('static_heuristic');
});

test('zero inputs actual → { total:0, stage3:0, executor:0 }', () => {
  const actual = computeActualCostCents({});
  expect(actual, 'all zeros').toEqual({ total: 0, stage3: 0, executor: 0 });
});

// ── Stage 3 only ──────────────────────────────────────────────────────────────

test('Stage 3 parse only → medium confidence, planner_estimate', () => {
  // Use large enough token counts to produce nonzero rounded cents
  const preview = computePlannerCostPreview({
    stage3ParseUsage: { inputTokens: 100_000, outputTokens: 20_000, model: 'claude-haiku-4-5' },
  });
  expect(preview.confidence, 'confidence degrades to medium with Stage 3').toBe('medium');
  expect(preview.basedOn, 'basedOn').toBe('planner_estimate');
  expect(preview.predictedCostCents > 0, 'cost > 0 for non-trivial token usage').toBeTruthy();
});

// ── Escalation ────────────────────────────────────────────────────────────────

test('escalation adds to Stage 3 cost and drops confidence to low', () => {
  const preview = computePlannerCostPreview({
    stage3ParseUsage:      { inputTokens: 1_000, outputTokens: 200, model: 'claude-haiku-4-5' },
    stage3EscalationUsage: { inputTokens: 2_000, outputTokens: 400, model: 'claude-sonnet-4-6' },
  });
  expect(preview.confidence, 'confidence is low after escalation').toBe('low');
  expect(preview.predictedCostCents > 0, 'escalation adds cost').toBeTruthy();

  const actual = computeActualCostCents({
    stage3ParseUsage:      { inputTokens: 1_000, outputTokens: 200, model: 'claude-haiku-4-5' },
    stage3EscalationUsage: { inputTokens: 2_000, outputTokens: 400, model: 'claude-sonnet-4-6' },
  });
  expect(actual.stage3 > 0, 'stage3 cost positive after escalation').toBeTruthy();
  expect(actual.executor, 'executor=0 (no live calls)').toBe(0);
  expect(actual.total, 'total = stage3 when no live calls').toEqual(actual.stage3);
});

// ── Live-call count ───────────────────────────────────────────────────────────

test('live call count does not inflate total in v1 (live calls cost 0 cents)', () => {
  const actual = computeActualCostCents({ liveCallCount: 10 });
  expect(actual.executor, 'executor=0 (live cost is 0 in v1 pricing)').toBe(0);
  expect(actual.total, 'total=0 with only live calls').toBe(0);
});

// ── Actual vs predicted split ─────────────────────────────────────────────────

test('actualCostCents preserves stage3 / executor split', () => {
  const actual = computeActualCostCents({
    stage3ParseUsage: { inputTokens: 100_000, outputTokens: 10_000, model: 'claude-sonnet-4-6' },
    liveCallCount:    5,
  });
  expect(actual.stage3 > 0, 'stage3 > 0').toBeTruthy();
  expect(actual.executor, 'executor=0 for live in v1').toBe(0);
  expect(actual.total, 'total = stage3 + executor').toEqual(actual.stage3 + actual.executor);
});

// ── Hybrid live calls ──────────────────────────────────────────────────────────

test('hybrid live call count treated same as live (0 cents in v1)', () => {
  const actual = computeActualCostCents({ hybridLiveCallCount: 3 });
  expect(actual.executor, 'hybrid live calls cost 0 in v1 pricing').toBe(0);
  expect(actual.total, 'total=0').toBe(0);
});

// ── Summary ───────────────────────────────────────────────────────────────────
