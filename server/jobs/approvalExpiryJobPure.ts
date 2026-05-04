// ---------------------------------------------------------------------------
// approvalExpiryJobPure — pure helpers for the approval-expiry sweep
//
// No I/O. All functions are deterministic and side-effect-free.
// Impure orchestration lives in approvalExpiryJob.ts.
//
// Spec: tasks/builds/agentic-commerce/spec.md §4
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 5
// Invariant 12: pending_approval charges past approval_expires_at → denied/approval_expired
// ---------------------------------------------------------------------------

/** Row shape returned from the DB scan — minimal projection. */
export interface ExpiredPendingApprovalRow {
  id: string;
  status: string;
  approvalExpiresAt: Date | null;
}

/** Decision output for one row. */
export interface ApprovalExpiryDecision {
  chargeId: string;
  shouldExpire: boolean;
  reason: 'approval_expired' | 'already_resolved' | 'not_expired';
}

/**
 * Derive the UTC cutoff timestamp for the scan. Rows with
 * `approval_expires_at < cutoff` are candidates.
 */
export function deriveApprovalCutoff(jobRunAt: Date): Date {
  return new Date(jobRunAt.getTime());
}

/**
 * Decide whether a given row should be transitioned to `denied/approval_expired`.
 * Pure — no side effects.
 *
 * Rules (invariant 12):
 *   - Only rows still in `pending_approval` status are candidates.
 *   - approval_expires_at must be non-null and in the past.
 *   - Scoped to `pending_approval` ONLY — once a row leaves that status,
 *     approval_expires_at is inert.
 */
export function decideApprovalExpiry(
  row: ExpiredPendingApprovalRow,
  now: Date,
): ApprovalExpiryDecision {
  if (row.status !== 'pending_approval') {
    return { chargeId: row.id, shouldExpire: false, reason: 'already_resolved' };
  }

  if (!row.approvalExpiresAt || row.approvalExpiresAt >= now) {
    return { chargeId: row.id, shouldExpire: false, reason: 'not_expired' };
  }

  return { chargeId: row.id, shouldExpire: true, reason: 'approval_expired' };
}

/** Summary produced by one job tick. */
export interface ApprovalExpirySummary {
  scanned: number;
  expired: number;
  skipped: number;
  durationMs: number;
}
