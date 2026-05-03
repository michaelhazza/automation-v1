/**
 * server/services/taskVisibilityService.ts
 *
 * Impure wrapper around taskVisibilityPure.ts — resolves DB data then calls
 * the pure helper. Used by taskRoom.ts and taskEventStream.ts so neither file
 * needs to import db directly.
 */

import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks, workflowRuns, subaccountUserAssignments } from '../db/schema/index.js';
import { assertTaskVisibilityPure } from '../lib/taskVisibilityPure.js';

export interface TaskVisibilityContext {
  organisationId: string;
  subaccountId: string | null;
  requesterUserId: string | null;
}

/**
 * Load task visibility context for the given taskId.
 * Returns null when the task is not found or doesn't belong to the org.
 */
export async function loadTaskVisibilityContext(
  taskId: string,
  orgId: string,
): Promise<TaskVisibilityContext | null> {
  const [task] = await db
    .select({
      organisationId: tasks.organisationId,
      subaccountId: tasks.subaccountId,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, orgId), isNull(tasks.deletedAt)));

  if (!task) return null;

  // Resolve requesterUserId from the most recent workflow run for this task
  const [run] = await db
    .select({ startedByUserId: workflowRuns.startedByUserId })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.taskId, taskId), eq(workflowRuns.organisationId, orgId)))
    .orderBy(desc(workflowRuns.createdAt))
    .limit(1);

  return {
    organisationId: task.organisationId,
    subaccountId: task.subaccountId ?? null,
    requesterUserId: run?.startedByUserId ?? null,
  };
}

/**
 * Returns true when the user is allowed to view the task.
 * Accepts an already-loaded context (avoids double DB call when caller already did the lookup).
 * org_admin and system_admin always see the task if it belongs to the org.
 */
export async function resolveTaskVisibilityFromContext(
  userId: string,
  userRole: string,
  ctx: TaskVisibilityContext,
  orgId: string,
): Promise<boolean> {
  // Only load subaccount memberships for the 'user' role — other roles don't need them
  let userSubaccountIds: string[] = [];
  if (userRole === 'user') {
    const memberRows = await db
      .select({ subaccountId: subaccountUserAssignments.subaccountId })
      .from(subaccountUserAssignments)
      .where(eq(subaccountUserAssignments.userId, userId));
    userSubaccountIds = memberRows.map((r) => r.subaccountId);
  }

  return assertTaskVisibilityPure({
    userId,
    userRole,
    userSubaccountIds,
    task: ctx,
    orgId,
  });
}

/**
 * Returns true when the user is allowed to view the task.
 * Loads context from DB then calls resolveTaskVisibilityFromContext.
 */
export async function resolveTaskVisibility(
  userId: string,
  userRole: string,
  taskId: string,
  orgId: string,
): Promise<boolean> {
  const ctx = await loadTaskVisibilityContext(taskId, orgId);
  if (!ctx) return false;
  return resolveTaskVisibilityFromContext(userId, userRole, ctx, orgId);
}
