import { describe, it, expect } from 'vitest';
import {
  estimateCost,
  applyJudgeNeqCandidateRule,
  validateCostCap,
  aggregateModelStats,
  computeBenchSummary,
} from '../benchRunServicePure.js';

// ── estimateCost ──────────────────────────────────────────────────────────────

describe('estimateCost', () => {
  it('returns 0 for zero candidates', () => {
    expect(estimateCost({
      candidateModels: [],
      sampleCount: 5,
      costPerSampleCents: {},
      judgeCallsPerSample: 2,
      judgeCallCents: 10,
    })).toBe(0);
  });

  it('returns 0 for zero samples', () => {
    expect(estimateCost({
      candidateModels: ['model-a'],
      sampleCount: 0,
      costPerSampleCents: { 'model-a': 100 },
      judgeCallsPerSample: 2,
      judgeCallCents: 10,
    })).toBe(0);
  });

  it('computes candidate cost + judge cost correctly', () => {
    // 2 candidates × 5 samples × 100¢/sample = 1000¢ candidates
    // 2 candidates × 5 samples × 3 judge calls × 20¢/call = 600¢ judge
    // total = 1600¢
    const result = estimateCost({
      candidateModels: ['model-a', 'model-b'],
      sampleCount: 5,
      costPerSampleCents: { 'model-a': 100, 'model-b': 100 },
      judgeCallsPerSample: 3,
      judgeCallCents: 20,
    });
    expect(result).toBe(1600);
  });

  it('handles unknown model pricing as 0', () => {
    const result = estimateCost({
      candidateModels: ['model-unknown'],
      sampleCount: 5,
      costPerSampleCents: {},
      judgeCallsPerSample: 1,
      judgeCallCents: 10,
    });
    // unknown model cost = 0; judge = 1 × 5 × 1 × 10 = 50
    expect(result).toBe(50);
  });

  it('acceptance: 3 candidates × 5 samples produces reasonable estimate', () => {
    const result = estimateCost({
      candidateModels: ['m1', 'm2', 'm3'],
      sampleCount: 5,
      costPerSampleCents: { m1: 80, m2: 120, m3: 100 },
      judgeCallsPerSample: 2,
      judgeCallCents: 15,
    });
    // candidates: (80+120+100)×5 = 1500; judge: 3×5×2×15 = 450; total = 1950
    expect(result).toBe(1950);
  });
});

// ── applyJudgeNeqCandidateRule ────────────────────────────────────────────────

describe('applyJudgeNeqCandidateRule', () => {
  it('returns original judge when not a candidate', () => {
    const result = applyJudgeNeqCandidateRule({
      candidateModels: ['model-a', 'model-b'],
      judgeModelId: 'judge-model',
      orgDefaultJudge: 'default-judge',
    });
    expect(result.judgeModelId).toBe('judge-model');
    expect(result.swapNotice).toBeNull();
  });

  it('swaps judge to orgDefaultJudge when judge is a candidate', () => {
    const result = applyJudgeNeqCandidateRule({
      candidateModels: ['model-a', 'model-b', 'judge-model'],
      judgeModelId: 'judge-model',
      orgDefaultJudge: 'safe-judge',
    });
    expect(result.judgeModelId).toBe('safe-judge');
    expect(result.swapNotice).toContain('judge-model');
    expect(result.swapNotice).toContain('safe-judge');
  });

  it('acceptance: 3-candidate bench with judge in candidate list → swap notice', () => {
    const result = applyJudgeNeqCandidateRule({
      candidateModels: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      judgeModelId: 'claude-haiku-4-5-20251001',
      orgDefaultJudge: 'claude-sonnet-4-6',
    });
    expect(result.judgeModelId).not.toBe('claude-haiku-4-5-20251001');
    expect(result.swapNotice).not.toBeNull();
  });
});

// ── validateCostCap ───────────────────────────────────────────────────────────

describe('validateCostCap', () => {
  it('does not throw when estimated is under cap', () => {
    expect(() => validateCostCap(4000, 5000)).not.toThrow();
  });

  it('does not throw when estimated equals cap', () => {
    expect(() => validateCostCap(5000, 5000)).not.toThrow();
  });

  it('throws with statusCode 422 when over cap', () => {
    let thrown: unknown;
    try {
      validateCostCap(6000, 5000);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect((thrown as any).statusCode).toBe(422);
    expect((thrown as any).errorCode).toBe('BENCH_COST_CAP_EXCEEDED');
    expect((thrown as any).estimatedCents).toBe(6000);
    expect((thrown as any).capCents).toBe(5000);
  });

  it('acceptance: cost 6000 > cap 5000 → BENCH_COST_CAP_EXCEEDED', () => {
    expect(() => validateCostCap(6000, 5000)).toThrow(/5000/);
  });
});

// ── aggregateModelStats + computeBenchSummary ─────────────────────────────────

describe('aggregateModelStats', () => {
  const makeRows = (
    modelId: string,
    scores: Array<number | null>,
    verdict: 'pass' | 'fail' | 'inconclusive' = 'pass',
  ) =>
    scores.map((score, i) => ({
      candidateModelId: modelId,
      verdict: score === null ? 'inconclusive' as const : verdict,
      score,
      latencyMs: 100,
      costCents: 10,
    }));

  it('computes mean score correctly', () => {
    const rows = makeRows('m1', [0.8, 0.9, 0.7]);
    const [stat] = aggregateModelStats(rows);
    expect(stat!.meanScore).toBeCloseTo(0.8, 5);
  });

  it('passesAllPassMarks is false when any verdict is fail', () => {
    const rows = [
      { candidateModelId: 'm1', verdict: 'pass' as const, score: 0.9, latencyMs: 100, costCents: 10 },
      { candidateModelId: 'm1', verdict: 'fail' as const, score: 0.5, latencyMs: 100, costCents: 10 },
    ];
    const [stat] = aggregateModelStats(rows);
    expect(stat!.passesAllPassMarks).toBe(false);
  });

  it('handles all-null scores (inconclusive run)', () => {
    const rows = makeRows('m1', [null, null, null]);
    const [stat] = aggregateModelStats(rows);
    expect(stat!.meanScore).toBe(0);
    expect(stat!.variance).toBe(0);
    expect(stat!.passesAllPassMarks).toBe(true);  // no fails
  });

  it('separates results by candidate model', () => {
    const rows = [...makeRows('m1', [0.8, 0.9]), ...makeRows('m2', [0.6, 0.7])];
    const stats = aggregateModelStats(rows);
    expect(stats).toHaveLength(2);
    const m1 = stats.find(s => s.candidateModelId === 'm1')!;
    const m2 = stats.find(s => s.candidateModelId === 'm2')!;
    expect(m1.meanScore).toBeCloseTo(0.85, 5);
    expect(m2.meanScore).toBeCloseTo(0.65, 5);
  });
});

describe('computeBenchSummary', () => {
  it('returns recommendedModelId: null when no candidate qualifies', () => {
    const stats = [
      { candidateModelId: 'm1', meanScore: 0.5, variance: 0.2, meanLatencyMs: 100,
        totalCostCents: 100, sampleCount: 5, regressionRisk: 'high' as const, passesAllPassMarks: false },
    ];
    const { recommendedModelId } = computeBenchSummary(stats);
    expect(recommendedModelId).toBeNull();
  });

  it('returns cheapest qualifying candidate', () => {
    const stats = [
      { candidateModelId: 'expensive', meanScore: 0.9, variance: 0.01, meanLatencyMs: 200,
        totalCostCents: 500, sampleCount: 5, regressionRisk: 'low' as const, passesAllPassMarks: true },
      { candidateModelId: 'cheap', meanScore: 0.85, variance: 0.01, meanLatencyMs: 150,
        totalCostCents: 200, sampleCount: 5, regressionRisk: 'low' as const, passesAllPassMarks: true },
    ];
    const { recommendedModelId } = computeBenchSummary(stats);
    expect(recommendedModelId).toBe('cheap');
  });

  it('partial completion (all-fail stats) yields no recommendation', () => {
    const stats = [
      { candidateModelId: 'm1', meanScore: 0.3, variance: 0.05, meanLatencyMs: 100,
        totalCostCents: 50, sampleCount: 3, regressionRisk: 'medium' as const, passesAllPassMarks: false },
    ];
    const { recommendedModelId } = computeBenchSummary(stats);
    expect(recommendedModelId).toBeNull();
  });
});
