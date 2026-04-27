import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

const MIN_SAMPLE_COUNT = 10;
const LATENCY_RATIO = 1.5;
const MIN_ABSOLUTE_DELTA_MS = 500;

export const latencyCreep: Heuristic = {
  id: 'latency-creep',
  category: 'infrastructure',
  phase: '2.5',
  severity: 'low',
  confidence: 0.65,
  expectedFpRate: 0.10,
  requiresBaseline: [
    { entityKind: 'agent', metric: 'runtime_ms', minSampleCount: MIN_SAMPLE_COUNT },
  ],
  suppressions: [],
  firesPerEntityPerHour: 2,

  async evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;
    if (!run.durationMs) return { fired: false };

    const baseline = await ctx.baselines.getOrNull('agent', run.agentSlug, 'runtime_ms', MIN_SAMPLE_COUNT);
    if (!baseline) return { fired: false, reason: 'insufficient_data' };
    if (baseline.p95 <= 0) return { fired: false, reason: 'insufficient_data' };

    // Fires when this run's duration exceeds both ratio AND absolute threshold vs baseline p95
    const absoluteDelta = run.durationMs - baseline.p95;
    if (run.durationMs < baseline.p95 * LATENCY_RATIO || absoluteDelta < MIN_ABSOLUTE_DELTA_MS) {
      return { fired: false };
    }

    const evidence: Evidence = [{
      type: 'latency_creep',
      ref: run.runId,
      summary: `Runtime ${run.durationMs}ms > baseline p95 ${baseline.p95.toFixed(0)}ms * ${LATENCY_RATIO} AND +${MIN_ABSOLUTE_DELTA_MS}ms threshold`,
    }];
    return { fired: true, evidence, confidence: 0.65 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Agent runtime significantly exceeds baseline p95.';
  },
};
