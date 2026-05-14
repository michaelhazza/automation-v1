import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

export const maxTurnsHit: Heuristic = {
  id: 'max-turns-hit',
  category: 'agent_quality',
  phase: '2.0',
  severity: 'medium',
  confidence: 0.90,
  expectedFpRate: 0.02,
  requiresBaseline: [],
  suppressions: [
    {
      id: 'max-turns-acceptable',
      description: 'Operator marked this run as acceptable to hit max turns',
      predicate: (_ctx, evidence) => Boolean((evidence as unknown as Record<string, unknown>).maxTurnsAcceptable),
    },
  ],
  firesPerEntityPerHour: 1,

  async evaluate(_ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;

    if (!run.reachedMaxTurns) return { fired: false };

    const evidence: Evidence = [{
      type: 'max_turns_reached',
      ref: run.runId,
      summary: `Agent run exhausted its turn budget (status: ${run.status}).`,
    }];
    return { fired: true, evidence, confidence: 0.90 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Agent run hit the maximum turn limit — output is likely incomplete.';
  },
};
