import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { SkillExecutionEntity } from '../candidateTypes.js';

const SUCCESS_CLAIM_RE = /succeeded|was successful|completed successfully|has been (?:created|updated|sent|processed)/i;

export function claimsSuccess(text: string): boolean {
  return SUCCESS_CLAIM_RE.test(text);
}

export const toolFailedButAgentClaimedSuccess: Heuristic = {
  id: 'tool-failed-but-agent-claimed-success',
  category: 'skill_execution',
  phase: '2.0',
  severity: 'high',
  confidence: 0.80,
  expectedFpRate: 0.04,
  requiresBaseline: [],
  suppressions: [],
  firesPerEntityPerHour: 2,

  async evaluate(_ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const exec = candidate.entity as SkillExecutionEntity;

    if (exec.succeeded) return { fired: false };
    if (!exec.assistantMessageAfterTool) return { fired: false };
    if (!claimsSuccess(exec.assistantMessageAfterTool)) return { fired: false };

    const evidence: Evidence = [{
      type: 'tool_failed_agent_claimed_success',
      ref: exec.executionId,
      summary: `Skill '${exec.skillSlug}' returned an error but the subsequent assistant message claims success — possible confabulation.`,
    }];
    return { fired: true, evidence, confidence: 0.80 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Skill failed but agent message claims success — quality issue, possibly user-facing.';
  },
};
