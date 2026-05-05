import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

const FAILURE_LANGUAGE_RE = /i couldn'?t|i('m| am) unable|failed to|i don'?t have access/i;

export function containsFailureLanguage(text: string): boolean {
  return FAILURE_LANGUAGE_RE.test(text);
}

export const toolSuccessButFailureLanguage: Heuristic = {
  id: 'tool-success-but-failure-language',
  category: 'agent_quality',
  phase: '2.0',
  severity: 'medium',
  confidence: 0.70,
  expectedFpRate: 0.10,
  requiresBaseline: [],
  suppressions: [],
  firesPerEntityPerHour: 2,

  async evaluate(_ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;

    if (run.runResultStatus !== 'success') return { fired: false };
    if (!run.finalMessageContent) return { fired: false };
    if (!containsFailureLanguage(run.finalMessageContent)) return { fired: false };

    const evidence: Evidence = [{
      type: 'failure_language_in_success_run',
      ref: run.runId,
      summary: `Run marked success but final message contains failure language (matched FAILURE_LANGUAGE_RE).`,
    }];
    return { fired: true, evidence, confidence: 0.70 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Agent run reported success but the final message contains failure language.';
  },
};
