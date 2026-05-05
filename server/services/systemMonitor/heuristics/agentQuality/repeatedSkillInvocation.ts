import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

const INVOCATION_THRESHOLD = 5;
const BASELINE_TYPICAL_MAX = 2;

export const repeatedSkillInvocation: Heuristic = {
  id: 'repeated-skill-invocation',
  category: 'agent_quality',
  phase: '2.0',
  severity: 'low',
  confidence: 0.70,
  expectedFpRate: 0.05,
  requiresBaseline: [],
  suppressions: [],
  firesPerEntityPerHour: 1,

  async evaluate(_ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;

    for (const [slug, count] of Object.entries(run.skillInvocationCounts)) {
      if (count > INVOCATION_THRESHOLD) {
        const evidence: Evidence = [{
          type: 'repeated_skill_invocation',
          ref: run.runId,
          summary: `Skill '${slug}' invoked ${count}× in one run (threshold: >${INVOCATION_THRESHOLD}, typical baseline: ≤${BASELINE_TYPICAL_MAX}).`,
        }];
        return { fired: true, evidence, confidence: 0.70 };
      }
    }

    return { fired: false };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'A skill was invoked more than 5 times in a single run — possible loop.';
  },
};
