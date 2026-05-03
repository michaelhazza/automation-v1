/**
 * taskRoom.ts — join/leave handlers for the `task` room scope.
 *
 * Visibility rules (Chunk 10 — real implementation):
 *   - requester (user who started the workflow run for this task): always allowed
 *   - org_admin / manager: always allowed within the org
 *   - user role (subaccount level): allowed if in the task's subaccount
 *   - all others: denied
 *
 * Spec: docs/workflows-dev-spec.md §8 connection model, §14 visibility.
 */

import type { Socket } from 'socket.io';
import { logger } from '../lib/logger.js';
import type { SocketUser } from './auth.js';
import { resolveTaskVisibility } from '../services/taskVisibilityService.js';

// ─── Handler exports ──────────────────────────────────────────────────────────

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

  try {
    const allowed = await resolveTaskVisibility(user.id, user.role, taskId, orgId);
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

