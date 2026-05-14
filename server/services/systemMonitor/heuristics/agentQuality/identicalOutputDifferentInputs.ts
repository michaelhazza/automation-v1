import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

export const identicalOutputDifferentInputs: Heuristic = {
  id: 'identical-output-different-inputs',
  category: 'agent_quality',
  phase: '2.0',
  severity: 'medium',
  confidence: 0.75,
  expectedFpRate: 0.05,
  requiresBaseline: [],
  suppressions: [],
  firesPerEntityPerHour: 1,

  async evaluate(_ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;

    if (!run.outputHash) return { fired: false };

    // Look for a prior run in the last hour with the same output but different trigger.
    const matchingPrior = run.recentRunOutputs.find(
      prior => prior.runId !== run.runId
        && prior.outputHash === run.outputHash
        && prior.triggerHash !== null
        && run.outputHash !== null
        // Different trigger inputs:
        && prior.triggerHash !== (run.recentRunOutputs.find(r => r.runId === run.runId)?.triggerHash ?? null),
    );

    if (!matchingPrior) return { fired: false };

    const evidence: Evidence = [{
      type: 'identical_output_different_inputs',
      ref: run.runId,
      summary: `Run produced the same output as prior run ${matchingPrior.runId} despite different trigger context — possible prompt bug or stuck cache.`,
    }];
    return { fired: true, evidence, confidence: 0.75 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Agent produced identical output for different inputs within the last hour.';
  },
};
