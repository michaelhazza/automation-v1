import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

const MIN_SAMPLE_COUNT = 20;
// Fires when success_rate baseline p50 has degraded by ≥10pp vs baseline mean
const DROP_THRESHOLD = 0.10;

export const successRateDegradationTrend: Heuristic = {
  id: 'success-rate-degradation-trend',
  category: 'systemic',
  phase: '2.5',
  severity: 'high',
  confidence: 0.80,
  expectedFpRate: 0.05,
  requiresBaseline: [
    { entityKind: 'agent', metric: 'success_rate', minSampleCount: MIN_SAMPLE_COUNT },
  ],
  firesPerEntityPerHour: 1,

  async evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;
    const baseline = await ctx.baselines.getOrNull('agent', run.agentSlug, 'success_rate', MIN_SAMPLE_COUNT);
    if (!baseline) return { fired: false, reason: 'insufficient_data' };

    // success_rate p50 is the current-window rate; mean is the historical reference
    const currentRate = baseline.p50;
    const historicalRate = baseline.mean;
    if (historicalRate <= 0) return { fired: false, reason: 'insufficient_data' };

    if (currentRate >= historicalRate - DROP_THRESHOLD) return { fired: false };

    const evidence: Evidence = [{
      type: 'success_rate_degradation_trend',
      ref: run.agentSlug,
      summary: `Success rate p50=${(currentRate * 100).toFixed(1)}% dropped >${DROP_THRESHOLD * 100}pp below historical mean=${(historicalRate * 100).toFixed(1)}% (n=${baseline.sampleCount})`,
    }];
    return { fired: true, evidence, confidence: 0.80 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Agent success rate degradation trend detected.';
  },
};
