/**
 * server/lib/taskVisibilityPure.ts
 *
 * Pure helper for task visibility decisions. No I/O, no DB imports.
 *
 * Used by:
 *   - server/websocket/taskRoom.ts (join:task handler)
 *   - server/routes/taskEventStream.ts (replay endpoint)
 *
 * Spec: docs/workflows-dev-spec.md §14 visibility rules
 */

export interface TaskVisibilityInput {
  userId: string;
  userRole: string;
  userSubaccountIds: string[];  // subaccounts the user is a member of
  task: {
    organisationId: string;
    subaccountId: string | null;
    requesterUserId: string | null;  // user who started the associated workflow run
  };
  orgId: string;  // authenticated org context
}

/**
 * Returns true when the user is allowed to view the task.
 *
 * Rules (§14):
 *   1. requesterUserId matches: the user started this workflow run
 *   2. org_admin or manager (org-level managers): always allowed within org
 *   3. subaccount_admin (role=user): allowed if user is in the task's subaccount
 *   4. All others: denied
 */
export function assertTaskVisibilityPure(input: TaskVisibilityInput): boolean {
  const { userId, userRole, userSubaccountIds, task, orgId } = input;

  // Cross-org access is never allowed
  if (task.organisationId !== orgId) {
    return false;
  }

  // Rule 1: requester always sees their own tasks
  if (task.requesterUserId !== null && task.requesterUserId === userId) {
    return true;
  }

  // Rule 2: org_admin and manager have full org visibility
  if (userRole === 'org_admin' || userRole === 'manager' || userRole === 'system_admin') {
    return true;
  }

  // Rule 3: user role (subaccount-level) — allowed if in the task's subaccount
  if (userRole === 'user' && task.subaccountId !== null) {
    return userSubaccountIds.includes(task.subaccountId);
  }

  return false;
}
