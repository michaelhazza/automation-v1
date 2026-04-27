import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';
import { computeOutputEntropy } from '../../baselines/computeOutputEntropyPure.js';

const MIN_SAMPLE_COUNT = 15;
const ENTROPY_RATIO = 0.5; // 1h entropy < baseline p50 * 0.5

export const outputEntropyCollapse: Heuristic = {
  id: 'output-entropy-collapse',
  category: 'systemic',
  phase: '2.5',
  severity: 'medium',
  confidence: 0.72,
  expectedFpRate: 0.07,
  requiresBaseline: [
    { entityKind: 'agent', metric: 'token_count_output', minSampleCount: MIN_SAMPLE_COUNT },
  ],
  firesPerEntityPerHour: 1,

  async evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;
    if (!run.finalMessageContent || run.finalMessageContent.length < 50) return { fired: false };

    const baseline = await ctx.baselines.getOrNull('agent', run.agentSlug, 'token_count_output', MIN_SAMPLE_COUNT);
    if (!baseline) return { fired: false, reason: 'insufficient_data' };
    if (baseline.p50 <= 0) return { fired: false, reason: 'insufficient_data' };

    // Compute entropy of the run's final message (sampled at up to 1KB)
    const sample = run.finalMessageContent.slice(0, 1024);
    const entropy = computeOutputEntropy(sample);

    // Baseline entropy reference: p50 token_count used as proxy for typical output richness.
    // Low entropy signal: output is repetitive/degenerate compared to typical baseline length.
    // Entropy < 2.5 bits is considered low for natural language text.
    if (entropy >= 2.5) return { fired: false };

    // Also check that baseline shows enough normal output volume
    if (baseline.p50 < 50) return { fired: false };

    const evidence: Evidence = [{
      type: 'output_entropy_collapse',
      ref: run.runId,
      summary: `Output entropy ${entropy.toFixed(2)} bits (threshold 2.5) — possible repetitive/degenerate output (baseline p50=${baseline.p50.toFixed(0)} tokens)`,
    }];
    return { fired: true, evidence, confidence: 0.72 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Agent output entropy collapse — output may be repetitive or degenerate.';
  },
};
