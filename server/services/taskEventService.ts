/**
 * TaskEventService — validated, sequence-allocated emit path for task events.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/spec.md Chunk 9.
 *
 * This service is the write path for non-agent-run-shaped task events (pause,
 * resume, stop, gate updates, cadence chat cards, milestones). It owns:
 *
 *   1. Atomic per-task sequence allocation against `tasks.next_event_seq`
 *      (mirrors the `agentExecutionEventService.appendEvent` allocation; both
 *      paths bump the same column and never collide because the UPDATE is
 *      atomic per row). Without this, callers were passing `Date.now()` as a
 *      placeholder, poisoning the projection's delta-cursor (pr-review B2).
 *   2. WebSocket envelope emission to the `task:${taskId}` room.
 *
 * Persistence to `agent_execution_events` is deliberately NOT done here — the
 * column `agent_execution_events.run_id` is NOT NULL and references an
 * `agent_runs` row, but task-level events (pause/resume/stop/orchestrator
 * cards) have no associated agent run. Replay via the HTTP endpoint
 * therefore cannot reconstruct these events on full-rebuild — the projection's
 * pause/resume/stop state is whatever the live socket recorded. A schema
 * migration making `run_id` nullable (or adding `workflow_run_id`) is the
 * prerequisite for full persistence; tracked in tasks/todo.md as deferred S1.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks } from '../db/schema/tasks.js';
import type { TaskEvent, TaskEventEnvelope } from '../../shared/types/taskEvent.js';
import { validateTaskEvent, validateEventOrigin } from '../../shared/types/taskEventValidator.js';
import { emitTaskEvent } from '../websocket/emitters.js';
import { logger } from '../lib/logger.js';

export type EventOrigin = 'engine' | 'gate' | 'user' | 'orchestrator';

export interface TaskEventContext {
  taskId: string;
  organisationId: string;
  subaccountId: string | null;
}

export async function appendAndEmitTaskEvent(
  ctx: TaskEventContext,
  eventOrigin: EventOrigin,
  event: TaskEvent,
): Promise<void> {
  const validation = validateTaskEvent(event);
  if (!validation.ok) {
    logger.warn('task_event_invalid_payload', { taskId: ctx.taskId, reason: validation.reason });
    return;
  }
  if (!validateEventOrigin(eventOrigin)) {
    logger.warn('task_event_invalid_origin', { taskId: ctx.taskId, eventOrigin });
    return;
  }

  // Atomic per-task sequence allocation. The UPDATE locks the row for the
  // bump, so concurrent callers serialise correctly and each receives a
  // distinct increasing integer.
  const [taskRow] = await db
    .update(tasks)
    .set({ nextEventSeq: sql`${tasks.nextEventSeq} + 1` })
    .where(and(eq(tasks.id, ctx.taskId), eq(tasks.organisationId, ctx.organisationId)))
    .returning({ nextEventSeq: tasks.nextEventSeq });
  if (!taskRow) {
    logger.warn('task_event_task_missing', { taskId: ctx.taskId });
    return;
  }
  const allocatedTaskSeq = taskRow.nextEventSeq;

  const envelope: TaskEventEnvelope = {
    eventId: `task:${ctx.taskId}:${allocatedTaskSeq}:0:${event.kind}`,
    type: 'task:execution-event',
    entityId: ctx.taskId,
    timestamp: new Date().toISOString(),
    eventOrigin,
    taskSequence: allocatedTaskSeq,
    eventSubsequence: 0,
    eventSchemaVersion: 1,
    payload: event,
  };

  emitTaskEvent(ctx.taskId, envelope);
}
