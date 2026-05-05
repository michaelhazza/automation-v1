import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

const P95_MULTIPLIER = 5;
const ABSOLUTE_FLOOR_MS = 1000;
const MIN_SAMPLE_COUNT = 10;

export const runtimeAnomaly: Heuristic = {
  id: 'runtime-anomaly',
  category: 'agent_quality',
  phase: '2.0',
  severity: 'low',
  confidence: 0.65,
  expectedFpRate: 0.08,
  requiresBaseline: [
    { entityKind: 'agent', metric: 'runtime_ms', minSampleCount: MIN_SAMPLE_COUNT },
  ],
  suppressions: [
    {
      id: 'first-run-new-version',
      description: 'Suppress cold-start anomaly on first run after agent version change',
      predicate: (_ctx, evidence) => Boolean((evidence as unknown as Record<string, unknown>).isFirstRunNewVersion),
    },
  ],
  firesPerEntityPerHour: 1,

  async evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;
    if (run.durationMs == null) return { fired: false };

    const baseline = await ctx.baselines.getOrNull('agent', run.agentSlug, 'runtime_ms', MIN_SAMPLE_COUNT);
    if (!baseline) return { fired: false, reason: 'insufficient_data' };

    const threshold = baseline.p95 * P95_MULTIPLIER;
    if (run.durationMs <= threshold || run.durationMs <= ABSOLUTE_FLOOR_MS) return { fired: false };

    const evidence: Evidence = [{
      type: 'runtime_anomaly',
      ref: run.runId,
      summary: `Run took ${run.durationMs}ms — ${(run.durationMs / baseline.p95).toFixed(1)}× baseline p95 (${baseline.p95.toFixed(0)}ms, n=${baseline.sampleCount}).`,
    }];
    return { fired: true, evidence, confidence: 0.65 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Agent run duration exceeded 5× baseline p95.';
  },
};
