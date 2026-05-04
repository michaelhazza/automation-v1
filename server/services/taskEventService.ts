/**
 * TaskEventService — validated, sequence-allocated emit path for task events.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/spec.md Chunk 9.
 * Durability added: tasks/builds/pre-launch-hardening/plan.md D-P0-5.
 *
 * This service is the write path for non-agent-run-shaped task events (pause,
 * resume, stop, gate updates, cadence chat cards, milestones). It owns:
 *
 *   1. Atomic per-task sequence allocation against `tasks.next_event_seq`
 *      (mirrors the `agentExecutionEventService.appendEvent` allocation; both
 *      paths bump the same column and never collide because the UPDATE is
 *      atomic per row). Without this, callers were passing `Date.now()` as a
 *      placeholder, poisoning the projection's delta-cursor (pr-review B2).
 *   2. Durable persistence to `task_events` table inside the same transaction
 *      as the seq allocation. The socket emit happens AFTER commit so clients
 *      are never notified of a row that did not durably land.
 *   3. WebSocket envelope emission to the `task:${taskId}` room.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks } from '../db/schema/tasks.js';
import { taskEvents } from '../db/schema/taskEvents.js';
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

const MAX_PAYLOAD_BYTES = 64 * 1024; // 64KB

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

  // 64KB payload size guard — prevents runaway payloads from bloating the DB.
  const payloadBytes = Buffer.byteLength(JSON.stringify(event));
  if (payloadBytes > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `task_events payload too large: ${payloadBytes} bytes for event type ${event.kind}`,
    );
  }

  let allocatedTaskSeq!: number;

  // Atomic seq allocation + durable row insert inside a single transaction.
  // The socket emit below happens ONLY after this transaction commits so the
  // DB row is the source of truth — clients may miss the notification and
  // re-fetch the event log; that is acceptable.
  await db.transaction(async (tx) => {
    // Atomic per-task sequence allocation. The UPDATE locks the row for the
    // bump, so concurrent callers serialise correctly and each receives a
    // distinct increasing integer.
    const [taskRow] = await tx
      .update(tasks)
      .set({ nextEventSeq: sql`${tasks.nextEventSeq} + 1` })
      .where(and(eq(tasks.id, ctx.taskId), eq(tasks.organisationId, ctx.organisationId)))
      .returning({ nextEventSeq: tasks.nextEventSeq });

    if (!taskRow) {
      logger.warn('task_event_task_missing', { taskId: ctx.taskId });
      // Return without inserting — the outer function will return early below.
      return;
    }

    allocatedTaskSeq = taskRow.nextEventSeq;

    await tx.insert(taskEvents).values({
      taskId: ctx.taskId,
      organisationId: ctx.organisationId,
      subaccountId: ctx.subaccountId ?? null,
      seq: allocatedTaskSeq,
      eventType: event.kind,
      payload: event as Record<string, unknown>,
      origin: eventOrigin,
    });
  });

  // If the task was not found, allocatedTaskSeq was never set — exit silently.
  if (allocatedTaskSeq === undefined) return;

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

  // Socket emit is a notification, NOT the source of truth. The DB row
  // inserted above is durable; the emit merely informs connected clients.
  emitTaskEvent(ctx.taskId, envelope);
}
