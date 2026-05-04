/**
 * workflowApproverPoolServicePure — pure (no DB) helpers for approver-pool
 * resolution and membership checks.
 *
 * Spec: docs/workflows-dev-spec.md §5.1.
 *
 * Zero imports from the server layer — only shared types.
 */

import type { ApproverPoolSnapshot } from '../../shared/types/workflowApproverGroup.js';

/**
 * Returns true if userId is present in the approverPoolSnapshot.
 * Returns false when snapshot is null or empty — callers must decide what
 * "no pool configured" means for their permission context.
 *
 * NOTE: this differs from the existing workflowApprovalPoolPure.userInPool
 * which returns true on null/empty. This version is strict: null → false.
 * The null-snapshot bypass is enforced at the call site in decideApproval.
 */
export function userInPool(
  snapshot: ApproverPoolSnapshot | null,
  userId: string,
): boolean {
  if (!snapshot || snapshot.length === 0) {
    return false;
  }
  return snapshot.includes(userId);
}

