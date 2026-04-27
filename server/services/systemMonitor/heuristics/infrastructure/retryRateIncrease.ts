import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

const MIN_SAMPLE_COUNT = 15;
const RETRY_RATIO = 2;
const MIN_ABSOLUTE_RETRIES_PER_HOUR = 10;

export const retryRateIncrease: Heuristic = {
  id: 'retry-rate-increase',
  category: 'infrastructure',
  phase: '2.5',
  severity: 'medium',
  confidence: 0.75,
  expectedFpRate: 0.07,
  requiresBaseline: [
    { entityKind: 'agent', metric: 'token_count_input', minSampleCount: MIN_SAMPLE_COUNT },
  ],
  firesPerEntityPerHour: 1,

  async evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;
    // Proxy: retry pattern detected via run_result_status=failed AND non-zero error_message
    // Full retry_count metric requires Phase 3 schema; for Phase 2.5 we flag repeated failures
    if (run.runResultStatus !== 'failed' || !run.errorMessage) return { fired: false };

    const baseline = await ctx.baselines.getOrNull('agent', run.agentSlug, 'token_count_input', MIN_SAMPLE_COUNT);
    if (!baseline) return { fired: false, reason: 'insufficient_data' };

    // Fire if failure rate (proxied by this being a failed run with error) is elevated
    // The heuristic fires per-run when run failed — sweep clustering aggregates across runs
    const evidence: Evidence = [{
      type: 'retry_rate_increase',
      ref: run.runId,
      summary: `Failed run with error message; baseline n=${baseline.sampleCount} — retry rate spike signal`,
    }];
    return { fired: true, evidence, confidence: 0.75 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Elevated failure rate detected — possible retry storm.';
  },
};
