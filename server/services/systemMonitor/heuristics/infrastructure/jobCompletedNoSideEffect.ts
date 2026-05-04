import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { JobEntity } from '../candidateTypes.js';

// The sweep handler checks each completed job against a side-effect manifest
// (queried from per-job metadata or a registry). The entity carries
// expectedSideEffectPresent as a pre-computed boolean.

export const jobCompletedNoSideEffect: Heuristic = {
  id: 'job-completed-no-side-effect',
  category: 'infrastructure',
  phase: '2.0',
  severity: 'critical',
  confidence: 0.80,
  expectedFpRate: 0.02,
  requiresBaseline: [],
  suppressions: [],
  firesPerEntityPerHour: 1,

  async evaluate(_ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const job = candidate.entity as JobEntity;

    if (job.state !== 'completed') return { fired: false };
    if (job.expectedSideEffectPresent) return { fired: false };

    const evidence: Evidence = [{
      type: 'job_completed_no_side_effect',
      ref: job.jobId,
      summary: `pg-boss job '${job.queueName}' (${job.jobId}) completed but its expected side effect is absent — silent failure.`,
    }];
    return { fired: true, evidence, confidence: 0.80 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'A pg-boss job completed but produced no expected side effect — highest-cost class of silent failure.';
  },
};
