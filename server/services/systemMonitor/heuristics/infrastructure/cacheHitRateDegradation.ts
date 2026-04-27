import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

const MIN_SAMPLE_COUNT = 20;
const DROP_THRESHOLD = 0.20; // absolute drop below baseline p50

export const cacheHitRateDegradation: Heuristic = {
  id: 'cache-hit-rate-degradation',
  category: 'infrastructure',
  phase: '2.5',
  severity: 'low',
  confidence: 0.70,
  expectedFpRate: 0.08,
  requiresBaseline: [
    { entityKind: 'agent', metric: 'cache_hit_rate', minSampleCount: MIN_SAMPLE_COUNT },
  ],
  suppressions: [],
  firesPerEntityPerHour: 1,

  async evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;
    const baseline = await ctx.baselines.getOrNull('agent', run.agentSlug, 'cache_hit_rate', MIN_SAMPLE_COUNT);
    if (!baseline) return { fired: false, reason: 'insufficient_data' };

    // cache_hit_rate not tracked per-run in current schema — signal comes from baseline aggregate
    // This heuristic fires when the baseline itself records degraded p50 vs historical mean
    const currentRate = baseline.p50;
    const historicalMean = baseline.mean;
    if (historicalMean <= 0) return { fired: false, reason: 'insufficient_data' };

    if (currentRate >= historicalMean - DROP_THRESHOLD) return { fired: false };

    const evidence: Evidence = [{
      type: 'cache_hit_rate_degradation',
      ref: run.agentSlug,
      summary: `Cache hit rate p50=${currentRate.toFixed(2)} dropped >${DROP_THRESHOLD} below historical mean=${historicalMean.toFixed(2)}`,
    }];
    return { fired: true, evidence, confidence: 0.70 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'LLM cache hit rate degradation detected.';
  },
};
