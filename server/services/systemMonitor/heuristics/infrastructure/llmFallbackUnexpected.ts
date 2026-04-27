import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

// LLM fallback detection. Full implementation requires llm_router_calls table (Phase 3).
// For Phase 2.5, fires when the run's error or summary signals provider-level fallback.
const FALLBACK_PATTERNS = [/fallback.?model/i, /provider.?unavailable/i, /switched.?to.?fallback/i, /model.?fallback/i];
const MIN_SAMPLE_COUNT = 10;
const FALLBACK_THRESHOLD = 10; // approximate threshold per spec §9.6

export const llmFallbackUnexpected: Heuristic = {
  id: 'llm-fallback-unexpected',
  category: 'infrastructure',
  phase: '2.5',
  severity: 'medium',
  confidence: 0.68,
  expectedFpRate: 0.08,
  requiresBaseline: [
    { entityKind: 'agent', metric: 'token_count_input', minSampleCount: MIN_SAMPLE_COUNT },
  ],
  firesPerEntityPerHour: 1,

  async evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const run = candidate.entity as AgentRunEntity;
    const baseline = await ctx.baselines.getOrNull('agent', run.agentSlug, 'token_count_input', MIN_SAMPLE_COUNT);
    if (!baseline) return { fired: false, reason: 'insufficient_data' };

    const errorHasFallback = FALLBACK_PATTERNS.some(p => p.test(run.errorMessage ?? ''));
    const summaryHasFallback = FALLBACK_PATTERNS.some(p => p.test(run.summary ?? ''));

    if (!errorHasFallback && !summaryHasFallback) return { fired: false };

    // Only fire if baseline has enough samples to confirm this is unexpected
    if (baseline.sampleCount < FALLBACK_THRESHOLD) return { fired: false, reason: 'insufficient_data' };

    const evidence: Evidence = [{
      type: 'llm_fallback_unexpected',
      ref: run.runId,
      summary: `LLM fallback pattern detected — error: "${(run.errorMessage ?? '').slice(0, 80)}"`,
    }];
    return { fired: true, evidence, confidence: 0.68 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Unexpected LLM provider fallback invocation.';
  },
};
