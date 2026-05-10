// supportEvalHarnessPure.test.ts — Unit tests for eval harness pure helpers.
// Spec: tasks/builds/phase-1-showcase-mvps/spec.md §5.5.2, §7.3

import { describe, it, expect } from 'vitest';
import {
  evaluateGateDecision,
  isClassificationBelowThreshold,
  isJudgeScoreBelowThreshold,
  computeDrift,
  type SupportEvalRunSnapshot,
} from '../supportEvalHarnessPure.js';

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<SupportEvalRunSnapshot> & { id: string }): SupportEvalRunSnapshot {
  return {
    classificationAccuracyPerIntent: { billing: 0.9, shipping: 0.85 },
    draftJudgeScoreAvg: 0.88,
    thresholdClassificationMin: 0.8,
    thresholdJudgeMin: 0.75,
    partial: false,
    rowCount: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// evaluateGateDecision — five fixture sets
// ---------------------------------------------------------------------------

describe('evaluateGateDecision', () => {
  it('returns pass when both rows meet both thresholds', () => {
    const rows = [
      makeSnapshot({ id: 'a', draftJudgeScoreAvg: 0.90 }),
      makeSnapshot({ id: 'b', draftJudgeScoreAvg: 0.85 }),
    ];
    const result = evaluateGateDecision(rows);
    expect(result.verdict).toBe('pass');
  });

  it('returns fail when both rows fail classification (same metric)', () => {
    // Both have avg accuracy 0.5 against threshold 0.8
    const rows = [
      makeSnapshot({ id: 'a', classificationAccuracyPerIntent: { billing: 0.5, shipping: 0.5 } }),
      makeSnapshot({ id: 'b', classificationAccuracyPerIntent: { billing: 0.5, shipping: 0.5 } }),
    ];
    const result = evaluateGateDecision(rows);
    expect(result.verdict).toBe('fail');
    expect(result.reason).toMatch(/classification/i);
  });

  it('returns pass when rows fail different metrics (not the same metric both fail)', () => {
    // Row a: classification fails, judge ok
    // Row b: classification ok, judge fails
    const rowA = makeSnapshot({
      id: 'a',
      classificationAccuracyPerIntent: { billing: 0.5 }, // avg 0.5 < threshold 0.8
      draftJudgeScoreAvg: 0.90, // above threshold 0.75
    });
    const rowB = makeSnapshot({
      id: 'b',
      classificationAccuracyPerIntent: { billing: 0.9 }, // avg 0.9 >= threshold 0.8
      draftJudgeScoreAvg: 0.60, // below threshold 0.75
    });
    const result = evaluateGateDecision([rowA, rowB]);
    expect(result.verdict).toBe('pass');
  });

  it('returns fail_open for a single row (fewer than 2)', () => {
    const rows = [makeSnapshot({ id: 'a' })];
    const result = evaluateGateDecision(rows);
    expect(result.verdict).toBe('fail_open');
    expect(result.reason).toMatch(/fewer than 2/i);
  });

  it('returns fail_open for zero rows', () => {
    const result = evaluateGateDecision([]);
    expect(result.verdict).toBe('fail_open');
    expect(result.reason).toMatch(/fewer than 2/i);
  });

  it('returns fail_open when both rows are partial', () => {
    const rows = [
      makeSnapshot({ id: 'a', partial: true }),
      makeSnapshot({ id: 'b', partial: true }),
    ];
    const result = evaluateGateDecision(rows);
    expect(result.verdict).toBe('fail_open');
    expect(result.reason).toMatch(/partial/i);
  });

  it('returns fail when both rows fail judge score (same metric)', () => {
    const rows = [
      makeSnapshot({ id: 'a', draftJudgeScoreAvg: 0.60 }), // < threshold 0.75
      makeSnapshot({ id: 'b', draftJudgeScoreAvg: 0.55 }), // < threshold 0.75
    ];
    const result = evaluateGateDecision(rows);
    expect(result.verdict).toBe('fail');
    expect(result.reason).toMatch(/judge/i);
  });
});

// ---------------------------------------------------------------------------
// isClassificationBelowThreshold
// ---------------------------------------------------------------------------

describe('isClassificationBelowThreshold', () => {
  it('returns false when average accuracy is above threshold', () => {
    expect(isClassificationBelowThreshold({ billing: 0.9, shipping: 0.85 }, 0.8)).toBe(false);
  });

  it('returns true when average accuracy is below threshold', () => {
    expect(isClassificationBelowThreshold({ billing: 0.5, shipping: 0.6 }, 0.8)).toBe(true);
  });

  it('returns true for empty accuracy map', () => {
    expect(isClassificationBelowThreshold({}, 0.8)).toBe(true);
  });

  it('returns false when accuracy equals threshold exactly', () => {
    expect(isClassificationBelowThreshold({ billing: 0.8 }, 0.8)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isJudgeScoreBelowThreshold
// ---------------------------------------------------------------------------

describe('isJudgeScoreBelowThreshold', () => {
  it('returns false when score is above threshold', () => {
    expect(isJudgeScoreBelowThreshold(0.85, 0.75)).toBe(false);
  });

  it('returns true when score is below threshold', () => {
    expect(isJudgeScoreBelowThreshold(0.60, 0.75)).toBe(true);
  });

  it('returns false when score equals threshold', () => {
    expect(isJudgeScoreBelowThreshold(0.75, 0.75)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeDrift
// ---------------------------------------------------------------------------

describe('computeDrift', () => {
  it('returns null when previous is null (no baseline)', () => {
    const current = makeSnapshot({ id: 'a' });
    const result = computeDrift(current, null);
    expect(result).toBeNull();
  });

  it('returns correct deltas when both snapshots have data', () => {
    const current = makeSnapshot({
      id: 'a',
      classificationAccuracyPerIntent: { billing: 0.9 },
      draftJudgeScoreAvg: 0.88,
    });
    const previous = makeSnapshot({
      id: 'b',
      classificationAccuracyPerIntent: { billing: 0.8 },
      draftJudgeScoreAvg: 0.80,
    });
    const result = computeDrift(current, previous);
    expect(result).not.toBeNull();
    expect(result!.accuracyDelta).toBeCloseTo(0.1, 5);
    expect(result!.judgeScoreDelta).toBeCloseTo(0.08, 5);
  });

  it('returns null accuracyDelta when current accuracy map is empty', () => {
    const current = makeSnapshot({
      id: 'a',
      classificationAccuracyPerIntent: {},
    });
    const previous = makeSnapshot({ id: 'b' });
    const result = computeDrift(current, previous);
    expect(result).not.toBeNull();
    expect(result!.accuracyDelta).toBeNull();
  });

  it('returns negative deltas when current is worse than previous', () => {
    const current = makeSnapshot({
      id: 'a',
      classificationAccuracyPerIntent: { billing: 0.7 },
      draftJudgeScoreAvg: 0.72,
    });
    const previous = makeSnapshot({
      id: 'b',
      classificationAccuracyPerIntent: { billing: 0.9 },
      draftJudgeScoreAvg: 0.88,
    });
    const result = computeDrift(current, previous);
    expect(result).not.toBeNull();
    expect(result!.accuracyDelta).toBeLessThan(0);
    expect(result!.judgeScoreDelta).toBeLessThan(0);
  });
});
