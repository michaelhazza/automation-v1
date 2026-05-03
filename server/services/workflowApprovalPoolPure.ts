/**
 * workflowApprovalPoolPure — pure (no DB) helpers for approver-pool membership.
 *
 * Spec: docs/workflows-dev-spec.md §18.1 (pre-existing violation #1 fix).
 *
 * V1 pool check is strict: org-admin membership does NOT auto-bypass the pool.
 * The pool snapshot is a string[] of user IDs. Membership is an exact set lookup.
 */

import type { ApproverPoolSnapshot } from '../../shared/types/workflowStepGate.js';

/**
 * Returns true if userId is present in the approverPoolSnapshot.
 * Returns true (allow) when snapshot is null or empty — no pool configured means
 * any org-permissioned user may act. The pre-existing violation #1 guard calls
 * this only when a gate row exists and has a non-null snapshot.
 *
 * V1 NOTE: org-admin status is NOT an auto-bypass. Pool check is strict.
 */
export function userInPool(approverPoolSnapshot: ApproverPoolSnapshot | null | undefined, userId: string): boolean {
  if (!approverPoolSnapshot || approverPoolSnapshot.length === 0) {
    // No pool configured — allow any permissioned user.
    return true;
  }
  return approverPoolSnapshot.includes(userId);
}

/**
 * Resolve a pool consisting of a specific list of user IDs (no DB needed).
 * Returns the list unchanged. Exists as a named helper so callers have a
 * consistent interface for pool resolution across pool types.
 */
export function resolveSpecificUsersPool(userIds: string[]): ApproverPoolSnapshot {
  return userIds;
}
