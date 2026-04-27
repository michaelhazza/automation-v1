import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';
import { computeKLDivergence, buildToolDistribution } from '../../baselines/computeKLDivergencePure.js';

const MIN_SAMPLE_COUNT = 20;
const KL_THRESHOLD = parseFloat(process.env.SYSTEM_MONITOR_TOOL_DRIFT_KL_THRESHOLD ?? '1.5');

export const toolSelectionDrift: Heuristic = {
  id: 'tool-selection-drift',
  category: 'systemic',
  phase: '2.5',
  severity: 'medium',
  confidence: 0.68,
  expectedFpRate: 0.09,
  requiresBaseline: [
    { entityKind: 'agent', metric: 'runtime_ms', minSampleCount: MIN_SAMPLE_COUNT },
  ],
  suppressions: [],
  firesPerEntityPerHour: 1,

  async evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;
    const baseline = await ctx.baselines.getOrNull('agent', run.agentSlug, 'runtime_ms', MIN_SAMPLE_COUNT);
    if (!baseline) return { fired: false, reason: 'insufficient_data' };

    // Phase 2.5: skill invocation counts are Phase 2.5 enrichment, not yet populated.
    // Use recentRunOutputs as proxy — if empty, return insufficient_data.
    if (!run.skillInvocationCounts || Object.keys(run.skillInvocationCounts).length === 0) {
      return { fired: false, reason: 'insufficient_data' };
    }

    // baseline stores tool distribution shape via entity_change_marker (Phase 3 full impl).
    // For Phase 2.5, compare this run's distribution to a flat prior.
    const priorDist = Object.fromEntries(
      Object.keys(run.skillInvocationCounts).map(k => [k, 1])
    );
    const currentDist = run.skillInvocationCounts as Record<string, number>;

    let kl: number;
    try {
      kl = computeKLDivergence(currentDist, priorDist);
    } catch {
      return { fired: false, reason: 'insufficient_data' };
    }

    if (kl < KL_THRESHOLD) return { fired: false };

    const evidence: Evidence = [{
      type: 'tool_selection_drift',
      ref: run.runId,
      summary: `Tool selection KL divergence ${kl.toFixed(2)} exceeds threshold ${KL_THRESHOLD}`,
    }];
    return { fired: true, evidence, confidence: 0.68 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Tool selection pattern has drifted significantly from prior distribution.';
  },
};
