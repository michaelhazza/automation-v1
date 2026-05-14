import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

// Fires when the final message ends without terminal punctuation AND its
// length is within 10% of the model's configured max output tokens
// (proxy: tokenBudget — the budget the agent ran with).
// The 10% proximity threshold is converted to a chars-per-token approximation.
const TRUNCATION_PROXIMITY_RATIO = 0.90; // within 10% of budget → likely truncated
const AVG_CHARS_PER_TOKEN = 4;
const TERMINAL_RE = /[.!?'")\]}\n]$/;

export function looksLikeTruncated(
  content: string,
  lengthChars: number,
  tokenBudget: number,
): boolean {
  if (TERMINAL_RE.test(content)) return false;
  const estimatedMaxChars = tokenBudget * AVG_CHARS_PER_TOKEN;
  return lengthChars >= estimatedMaxChars * TRUNCATION_PROXIMITY_RATIO;
}

export const outputTruncation: Heuristic = {
  id: 'output-truncation',
  category: 'agent_quality',
  phase: '2.0',
  severity: 'low',
  confidence: 0.55,
  expectedFpRate: 0.15,
  requiresBaseline: [],
  suppressions: [],
  firesPerEntityPerHour: 1,

  async evaluate(_ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;

    if (!run.finalMessageContent || run.finalMessageLengthChars === 0) return { fired: false };
    if (!looksLikeTruncated(run.finalMessageContent, run.finalMessageLengthChars, run.tokenBudget)) {
      return { fired: false };
    }

    const evidence: Evidence = [{
      type: 'output_truncation',
      ref: run.runId,
      summary: `Final message (${run.finalMessageLengthChars} chars) likely truncated — no terminal punctuation and within 10% of max output budget.`,
    }];
    return { fired: true, evidence, confidence: 0.55 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Agent output appears truncated — no terminal punctuation near the token limit.';
  },
};
