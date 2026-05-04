// ---------------------------------------------------------------------------
// executionWindowTimeoutJobPure — pure helpers for the execution-window sweep
//
// No I/O. All functions are deterministic and side-effect-free.
// Impure orchestration lives in executionWindowTimeoutJob.ts.
//
// Spec: tasks/builds/agentic-commerce/spec.md §4
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 5
// Invariant 11: approved charges past expires_at → failed/execution_timeout
// ---------------------------------------------------------------------------

/** Row shape returned from the DB scan — minimal projection. */
export interface ExpiredApprovedRow {
  id: string;
  status: string;
  expiresAt: Date | null;
}

/** Decision output for one row. */
export interface TimeoutDecision {
  chargeId: string;
  shouldTimeout: boolean;
  reason: 'execution_timeout' | 'already_terminal' | 'not_expired';
}

/**
 * Derive the UTC cutoff timestamp for the scan. Rows with
 * `expires_at < cutoff` are candidates. Uses the job's run time,
 * not a hardcoded constant, so the test can supply any date.
 */
export function deriveCutoff(jobRunAt: Date): Date {
  // The cutoff is simply the run time — any row already past expires_at qualifies.
  return new Date(jobRunAt.getTime());
}

/**
 * Decide whether a given row should be transitioned to `failed`.
 * Pure — no side effects.
 *
 * Rules (invariant 11):
 *   - Only rows still in `approved` status are candidates.
 *   - MUST NOT touch `executed` rows.
 *   - expires_at must be non-null and in the past.
 */
export function decideTimeout(
  row: ExpiredApprovedRow,
  now: Date,
): TimeoutDecision {
  if (row.status !== 'approved') {
    return { chargeId: row.id, shouldTimeout: false, reason: 'already_terminal' };
  }

  if (!row.expiresAt || row.expiresAt >= now) {
    return { chargeId: row.id, shouldTimeout: false, reason: 'not_expired' };
  }

  return { chargeId: row.id, shouldTimeout: true, reason: 'execution_timeout' };
}

/** Summary produced by one job tick. */
export interface ExecutionWindowTimeoutSummary {
  scanned: number;
  timedOut: number;
  skipped: number;
  durationMs: number;
}
