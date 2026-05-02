/**
 * workflowApproverPoolServicePure — pure, DB-free helpers for approver pool resolution.
 *
 * Paired with: workflowApproverPoolService.ts (impure, DB-bound).
 */

import type { ApproverGroup, ApproverPoolSnapshot } from '../../shared/types/workflowStepGate.js';

export type { ApproverGroup };

/**
 * Returns true if userId is in the given pool snapshot.
 * null or empty array = open pool (everyone qualifies).
 */
export function userInPool(snapshot: ApproverPoolSnapshot | null, userId: string): boolean {
  if (!snapshot || snapshot.length === 0) return true;
  return snapshot.includes(userId);
}

/**
 * Build an ApproverPoolSnapshot from an explicit list of user IDs.
 * Validator is expected to have verified the IDs exist before calling this.
 */
export function resolveSpecificUsersPool(userIds: string[]): ApproverPoolSnapshot {
  return [...userIds];
}
