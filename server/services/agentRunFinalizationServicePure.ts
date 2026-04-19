/**
 * agentRunFinalizationServicePure — pure logic for IEE Phase 0 finalisation.
 *
 * Extracted from agentRunFinalizationService.ts so the mapping + summary
 * helpers can be unit-tested without pulling in DB / env / websocket
 * dependencies at module load. The DB-touching entry points
 * (finaliseAgentRunFromIeeRun, reconcileStuckDelegatedRuns) remain in the
 * non-pure file and delegate to these helpers.
 *
 * Spec: docs/iee-delegation-lifecycle-spec.md §3, Appendix A.
 */

export type IeeRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type IeeFailureReason = string | null;

/** Input shape consumed by buildSummaryFromIeeRun — the subset of iee_runs
 *  row fields the summary helper reads. Keeping it narrow here avoids
 *  pulling in the full Drizzle IeeRun type (which depends on DB infra). */
export interface SummaryInput {
  type: 'browser' | 'dev';
  status: IeeRunStatus;
  failureReason: IeeFailureReason;
  resultSummary: unknown;
}

/**
 * Map a terminal iee_runs outcome to a terminal agent_runs status.
 *
 * Decisions baked in per docs/iee-delegation-lifecycle-spec.md Appendix A:
 *  - User-initiated cancellation (iee_runs.status='cancelled') → 'cancelled'
 *  - Worker-originated stoppage (failureReason='worker_terminated') → 'failed'
 *    (NOT 'cancelled' — worker termination is an infrastructure failure,
 *     not user intent)
 *  - timeout / budget_exceeded / step_limit_reached map to their closest
 *    existing parent enum value.
 *  - All other failures fall through to generic 'failed' with failureReason
 *    carried in the summary.
 */
export function mapIeeStatusToAgentRunStatus(
  ieeStatus: IeeRunStatus,
  failureReason: IeeFailureReason,
): 'completed' | 'failed' | 'timeout' | 'cancelled' | 'loop_detected' | 'budget_exceeded' {
  if (ieeStatus === 'completed') return 'completed';
  if (ieeStatus === 'cancelled') return 'cancelled';
  switch (failureReason) {
    case 'timeout':            return 'timeout';
    case 'budget_exceeded':    return 'budget_exceeded';
    case 'step_limit_reached': return 'loop_detected';
    default:                   return 'failed';
  }
}

/**
 * Build a human-readable summary for the parent agent_run from an iee_run
 * row. Prefers iee_runs.resultSummary.output when present as a non-empty
 * string; falls back to a templated string derived from status +
 * failureReason. Truncates at 500 chars with ellipsis.
 */
export function buildSummaryFromIeeRun(run: SummaryInput): string {
  let summary: string;
  const result = run.resultSummary as Record<string, unknown> | null;
  if (result && typeof result.output === 'string' && result.output.length > 0) {
    summary = result.output;
  } else if (run.status === 'completed') {
    summary = `IEE ${run.type} task completed`;
  } else if (run.status === 'cancelled') {
    summary = `IEE ${run.type} task cancelled`;
  } else {
    const reason = run.failureReason ?? 'unknown';
    summary = `IEE ${run.type} task failed (${reason})`;
  }
  if (summary.length > 500) {
    summary = summary.slice(0, 497) + '...';
  }
  return summary;
}
