import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

const P95_MULTIPLIER = 3;
const ABSOLUTE_FLOOR_TOKENS = 5000;
const MIN_SAMPLE_COUNT = 10;

export const tokenAnomaly: Heuristic = {
  id: 'token-anomaly',
  category: 'agent_quality',
  phase: '2.0',
  severity: 'low',
  confidence: 0.60,
  expectedFpRate: 0.10,
  requiresBaseline: [
    { entityKind: 'agent', metric: 'token_count_input', minSampleCount: MIN_SAMPLE_COUNT },
    { entityKind: 'agent', metric: 'token_count_output', minSampleCount: MIN_SAMPLE_COUNT },
  ],
  suppressions: [],
  firesPerEntityPerHour: 1,

  async evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;
    const total = run.totalTokens;
    if (total < ABSOLUTE_FLOOR_TOKENS) return { fired: false };

    const baselineInput = await ctx.baselines.getOrNull('agent', run.agentSlug, 'token_count_input', MIN_SAMPLE_COUNT);
    const baselineOutput = await ctx.baselines.getOrNull('agent', run.agentSlug, 'token_count_output', MIN_SAMPLE_COUNT);
    if (!baselineInput || !baselineOutput) return { fired: false, reason: 'insufficient_data' };

    const combinedP95 = baselineInput.p95 + baselineOutput.p95;
    const threshold = combinedP95 * P95_MULTIPLIER;
    if (total <= threshold) return { fired: false };

    const evidence: Evidence = [{
      type: 'token_anomaly',
      ref: run.runId,
      summary: `Run consumed ${total} tokens — ${(total / combinedP95).toFixed(1)}× baseline combined p95 (${combinedP95.toFixed(0)} tokens, n=${baselineInput.sampleCount}).`,
    }];
    return { fired: true, evidence, confidence: 0.60 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Agent run consumed more than 3× baseline p95 token count.';
  },
};
