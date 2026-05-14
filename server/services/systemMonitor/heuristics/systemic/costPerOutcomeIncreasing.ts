import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

const MIN_SAMPLE_COUNT = 15;
const COST_RATIO = 1.5; // 4h tokens_per_successful_run > baseline p95 * 1.5

export const costPerOutcomeIncreasing: Heuristic = {
  id: 'cost-per-outcome-increasing',
  category: 'systemic',
  phase: '2.5',
  severity: 'low',
  confidence: 0.65,
  expectedFpRate: 0.10,
  requiresBaseline: [
    { entityKind: 'agent', metric: 'cost_per_outcome', minSampleCount: MIN_SAMPLE_COUNT },
  ],
  suppressions: [],
  firesPerEntityPerHour: 1,

  async evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;
    // Only fire for successful runs (cost_per_outcome tracks tokens on success)
    if (run.runResultStatus !== 'success') return { fired: false };

    const baseline = await ctx.baselines.getOrNull('agent', run.agentSlug, 'cost_per_outcome', MIN_SAMPLE_COUNT);
    if (!baseline) return { fired: false, reason: 'insufficient_data' };
    if (baseline.p95 <= 0) return { fired: false, reason: 'insufficient_data' };

    const runTokens = run.inputTokens + run.outputTokens;
    if (runTokens < baseline.p95 * COST_RATIO) return { fired: false };

    const evidence: Evidence = [{
      type: 'cost_per_outcome_increasing',
      ref: run.runId,
      summary: `Successful run used ${runTokens} tokens; baseline p95=${baseline.p95.toFixed(0)} tokens (ratio=${(runTokens / baseline.p95).toFixed(1)}x)`,
    }];
    return { fired: true, evidence, confidence: 0.65 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Cost per successful outcome is increasing vs baseline.';
  },
};
