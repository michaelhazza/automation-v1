/**
 * Task WebSocket room handlers.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/spec.md Chunk 9.
 *
 * Validates org ownership before joining the `task:${taskId}` room.
 * Mirrors the pattern used for workflow-run rooms in rooms.ts.
 */

import type { Socket } from 'socket.io';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks } from '../db/schema/tasks.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

export async function handleJoinTask(socket: Socket, taskId: unknown): Promise<void> {
  if (!isValidUUID(taskId)) return;
  const orgId = socket.data.orgId as string | undefined;
  if (!orgId) return;
  try {
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, orgId)));
    if (!task) return; // silently reject — wrong org or not found
    socket.join(`task:${taskId}`);
  } catch {
    // DB error — silently reject
  }
}

export function handleLeaveTask(socket: Socket, taskId: unknown): void {
  if (!isValidUUID(taskId)) return;
  socket.leave(`task:${taskId}`);
}
