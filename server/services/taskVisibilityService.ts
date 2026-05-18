/**
 * taskVisibilityService — resolves whether a principal can view/write a task
 * or conversation.
 *
 * Extracted from server/lib/briefVisibility.ts to keep DB access in the
 * services layer per the RLS architecture contract.
 */

import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { tasks, conversations } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { ORG_PERMISSIONS } from '../lib/permissions.js';

export interface TaskPrincipal {
  userId: string;
  organisationId: string;
  orgPermissions: Set<string>;
}

export interface TaskVisibility {
  canView: boolean;
  canWrite: boolean;
}

/** Resolves whether the given principal can view/write a specific Task. */
export async function resolveTaskVisibility(
  principal: TaskPrincipal,
  taskId: string,
): Promise<TaskVisibility> {
  const db = getOrgScopedDb('taskVisibilityService');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [task] = await db
    .select({ id: tasks.id, organisationId: tasks.organisationId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, principal.organisationId)))
    .limit(1);

  if (!task) return { canView: false, canWrite: false };

  const canView = principal.orgPermissions.has(ORG_PERMISSIONS.BRIEFS_READ);
  const canWrite = principal.orgPermissions.has(ORG_PERMISSIONS.TASKS_WRITE);

  return { canView, canWrite };
}

/** Resolves whether a principal can view/write to a conversation. */
export async function resolveConversationVisibility(
  principal: TaskPrincipal,
  conversationId: string,
): Promise<TaskVisibility> {
  const db = getOrgScopedDb('taskVisibilityService');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [conv] = await db
    .select({ id: conversations.id, organisationId: conversations.organisationId })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organisationId, principal.organisationId)))
    .limit(1);

  if (!conv) return { canView: false, canWrite: false };

  const canView = principal.orgPermissions.has(ORG_PERMISSIONS.BRIEFS_READ);
  const canWrite = principal.orgPermissions.has(ORG_PERMISSIONS.TASKS_WRITE);

  return { canView, canWrite };
}
