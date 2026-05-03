/**
 * taskRoom.ts — join/leave handlers for the `task` room scope.
 *
 * Visibility rules (stub for Chunk 10 to replace with full permission helpers):
 *   - org_admin: always allowed
 *   - subaccount_admin: allowed if the user belongs to the task's subaccount
 *   - any user: allowed if they are the task's requester (created_by field)
 *
 * Spec: docs/workflows-dev-spec.md §8 connection model.
 */

import type { Socket } from 'socket.io';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks } from '../db/schema/tasks.js';
import { orgUserRoles } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import type { SocketUser } from './auth.js';

// ─── Visibility stub ─────────────────────────────────────────────────────────

/**
 * Asserts the given user can view the task.
 *
 * TODO(Chunk 10): replace this stub with the real permission helper.
 * The spec requires: requesterUserId check + org admin + subaccount admin.
 * This stub currently allows ANY org member — too permissive for production.
 *
 * IMPORTANT: This stub MUST NOT ship to production as-is. It is intentionally
 * permissive so Chunk 9 can wire the room without blocking on Chunk 10's
 * permission system. The structured log below (`task_room_visibility_stub_used`)
 * makes it easy to confirm in prod logs whether this path is reachable.
 *
 * Returns true when the user is allowed. Returns false when denied.
 * Throws on DB errors (callers silently drop the join on any error).
 */
export async function assertTaskVisibility(
  userId: string,
  taskId: string,
  orgId: string,
): Promise<boolean> {
  // S2: structured log so this stub is searchable in prod logs.
  // If this fires in production, Chunk 10 is overdue.
  import('../lib/logger.js').then(({ logger }) => {
    logger.warn('task_room_visibility_stub_used', {
      event: 'ws.task_room.visibility_stub_used',
      userId,
      taskId,
      orgId,
      note: 'TODO(Chunk 10): replace with real permission check',
    });
  }).catch(() => { /* best-effort */ });

  const [task] = await db
    .select({
      id: tasks.id,
      subaccountId: tasks.subaccountId,
      createdByAgentId: tasks.createdByAgentId,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, orgId)));

  if (!task) return false;

  // TODO(Chunk 10): narrow this to requesterUserId + org admins + subaccount admins.
  // Currently: any org member is allowed (permissive stub).
  const [membership] = await db
    .select({ userId: orgUserRoles.userId })
    .from(orgUserRoles)
    .where(
      and(
        eq(orgUserRoles.userId, userId),
        eq(orgUserRoles.organisationId, orgId),
      )
    )
    .limit(1);

  return Boolean(membership);
}

// ─── Handler exports ─────────────────────────────────────────────────────────

export type AuthSocket = Socket & {
  data: {
    user: SocketUser;
    orgId: string;
    [key: string]: unknown;
  };
};

/**
 * Handle `join:task` from a client.
 * Validates the taskId belongs to the socket's org and the user can see it,
 * then joins the `task:${taskId}` room.
 */
export async function handleJoinTask(
  socket: AuthSocket,
  taskId: string,
): Promise<void> {
  const user = socket.data.user;
  const orgId = socket.data.orgId;

  // org_admin and system_admin bypass fine-grained visibility but still
  // verify the task belongs to the socket's org (N3: prevents cross-org leakage).
  if (user.role === 'org_admin' || user.role === 'system_admin') {
    try {
      const [task] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, orgId)));
      if (!task) return; // task not in this org — silently reject
    } catch {
      return; // DB error — silently reject
    }
    socket.join(`task:${taskId}`);
    return;
  }

  try {
    const allowed = await assertTaskVisibility(user.id, taskId, orgId);
    if (!allowed) return; // silently reject — no disclosure
    socket.join(`task:${taskId}`);
  } catch (err) {
    logger.warn('task_room_join_error', {
      event: 'ws.task_room.join_error',
      userId: user.id,
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });
    // DB error — silently reject
  }
}

/**
 * Handle `leave:task` from a client.
 */
export async function handleLeaveTask(
  socket: AuthSocket,
  taskId: string,
): Promise<void> {
  socket.leave(`task:${taskId}`);
}
