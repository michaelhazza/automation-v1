import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

export const finalMessageNotAssistant: Heuristic = {
  id: 'final-message-not-assistant',
  category: 'agent_quality',
  phase: '2.0',
  severity: 'medium',
  confidence: 0.85,
  expectedFpRate: 0.03,
  requiresBaseline: [],
  suppressions: [],
  firesPerEntityPerHour: 1,

  async evaluate(_ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;

    if (run.finalMessageRole === null) return { fired: false };
    if (run.finalMessageRole === 'assistant') return { fired: false };

    const evidence: Evidence = [{
      type: 'final_message_not_assistant',
      ref: run.runId,
      summary: `Run's final message has role '${run.finalMessageRole}' (expected 'assistant') — agent terminated mid-tool-call.`,
    }];
    return { fired: true, evidence, confidence: 0.85 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : "Agent run terminated without an assistant message — the operator never received a coherent response.";
  },
};
