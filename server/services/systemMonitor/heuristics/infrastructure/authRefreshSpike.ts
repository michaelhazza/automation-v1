import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

// Auth-refresh spike detection. Full implementation requires connector_polls table
// (Phase 3). For Phase 2.5, fires when the agent's error message pattern indicates
// auth-related retries (credential expired, auth_required, refresh_token).
const AUTH_ERROR_PATTERNS = [/auth.?refresh/i, /credential.*expired/i, /auth.?required/i, /refresh.?token/i];
const MIN_SAMPLE_COUNT = 10;

export const authRefreshSpike: Heuristic = {
  id: 'auth-refresh-spike',
  category: 'infrastructure',
  phase: '2.5',
  severity: 'medium',
  confidence: 0.72,
  expectedFpRate: 0.06,
  requiresBaseline: [
    { entityKind: 'agent', metric: 'runtime_ms', minSampleCount: MIN_SAMPLE_COUNT },
  ],
  suppressions: [],
  firesPerEntityPerHour: 1,

  async evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;
    if (!run.errorMessage) return { fired: false };

    const baseline = await ctx.baselines.getOrNull('agent', run.agentSlug, 'runtime_ms', MIN_SAMPLE_COUNT);
    if (!baseline) return { fired: false, reason: 'insufficient_data' };

    const isAuthError = AUTH_ERROR_PATTERNS.some(p => p.test(run.errorMessage ?? ''));
    if (!isAuthError) return { fired: false };

    const evidence: Evidence = [{
      type: 'auth_refresh_spike',
      ref: run.runId,
      summary: `Auth-related error pattern detected in run failure: "${(run.errorMessage ?? '').slice(0, 120)}"`,
    }];
    return { fired: true, evidence, confidence: 0.72 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Auth refresh spike — connector credential expiry or token refresh failure.';
  },
};
