import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

const MIN_BASELINE_P50 = 200; // chars — spec §9.5
const MIN_SAMPLE_COUNT = 10;

export const emptyOutputBaselineAware: Heuristic = {
  id: 'empty-output-baseline-aware',
  category: 'agent_quality',
  phase: '2.0',
  severity: 'medium',
  confidence: 0.80,
  expectedFpRate: 0.05,
  requiresBaseline: [
    { entityKind: 'agent', metric: 'output_length_chars', minSampleCount: MIN_SAMPLE_COUNT },
  ],
  suppressions: [
    {
      id: 'optional-output-declared',
      description: 'Agent declares optional output (no-op runs are expected)',
      predicate: (_ctx, evidence) => Boolean((evidence as unknown as Record<string, unknown>).optionalOutputDeclared),
    },
  ],
  firesPerEntityPerHour: 2,

  async evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;

    if (run.finalMessageLengthChars > 0) return { fired: false };

    const baseline = await ctx.baselines.getOrNull('agent', run.agentSlug, 'output_length_chars', MIN_SAMPLE_COUNT);
    if (!baseline) return { fired: false, reason: 'insufficient_data' };
    if (baseline.p50 <= MIN_BASELINE_P50) return { fired: false };

    const evidence: Evidence = [{
      type: 'empty_output_with_non_empty_baseline',
      ref: run.runId,
      summary: `Run produced 0 chars; baseline p50 = ${baseline.p50.toFixed(0)} chars (n=${baseline.sampleCount})`,
    }];
    return { fired: true, evidence, confidence: 0.80 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Agent produced empty output despite non-empty baseline.';
  },
};
