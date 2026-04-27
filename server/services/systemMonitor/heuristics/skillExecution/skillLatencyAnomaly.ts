import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { SkillExecutionEntity } from '../candidateTypes.js';

const P95_MULTIPLIER = 5;
const ABSOLUTE_FLOOR_MS = 500;
const MIN_SAMPLE_COUNT = 10;

export const skillLatencyAnomaly: Heuristic = {
  id: 'skill-latency-anomaly',
  category: 'skill_execution',
  phase: '2.0',
  severity: 'low',
  confidence: 0.65,
  expectedFpRate: 0.08,
  requiresBaseline: [
    { entityKind: 'skill', metric: 'runtime_ms', minSampleCount: MIN_SAMPLE_COUNT },
  ],
  suppressions: [],
  firesPerEntityPerHour: 1,

  async evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const exec = candidate.entity as SkillExecutionEntity;
    if (exec.durationMs == null) return { fired: false };
    if (exec.durationMs <= ABSOLUTE_FLOOR_MS) return { fired: false };

    const baseline = await ctx.baselines.getOrNull('skill', exec.skillSlug, 'runtime_ms', MIN_SAMPLE_COUNT);
    if (!baseline) return { fired: false, reason: 'insufficient_data' };

    const threshold = baseline.p95 * P95_MULTIPLIER;
    if (exec.durationMs <= threshold) return { fired: false };

    const evidence: Evidence = [{
      type: 'skill_latency_anomaly',
      ref: exec.executionId,
      summary: `Skill '${exec.skillSlug}' took ${exec.durationMs}ms — ${(exec.durationMs / baseline.p95).toFixed(1)}× baseline p95 (${baseline.p95.toFixed(0)}ms, n=${baseline.sampleCount}).`,
    }];
    return { fired: true, evidence, confidence: 0.65 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Skill execution duration exceeded 5× baseline p95.';
  },
};
