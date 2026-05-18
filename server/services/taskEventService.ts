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
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
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
    logger.warn('task_event_payload_too_large', {
      taskId: ctx.taskId,
      eventKind: event.kind,
      payloadBytes,
      limitBytes: MAX_PAYLOAD_BYTES,
    });
    throw new Error(
      `task_events payload too large: ${payloadBytes} bytes for event type ${event.kind}`,
    );
  }

  let allocatedTaskSeq: number | undefined;

  // Atomic seq allocation + durable row insert inside a single transaction.
  // The socket emit below happens ONLY after this transaction commits so the
  // DB row is the source of truth — clients may miss the notification and
  // re-fetch the event log; that is acceptable.
  try {
  await getOrgScopedDb('taskEventService.appendAndEmitTaskEvent').transaction(async (tx) => {
    // FORCE-RLS tables require the GUC before any tenant-table access.
    // This transaction is opened from the module-level db pool (callers use
    // fire-and-forget, so no outer org-scoped tx is guaranteed to be active).
    await tx.execute(sql`SELECT set_config('app.organisation_id', ${ctx.organisationId}, true)`);

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
  } catch (err: unknown) {
    // The uniq_approval_resolved_per_step constraint enforces exactly-one semantics.
    // On concurrent double-approve the second writer hits 23505 — the first write
    // won the race, so silently discard this duplicate and skip the socket emit.
    const cause = (err as { cause?: { code?: string; constraint_name?: string } }).cause;
    if (cause?.code === '23505' && cause?.constraint_name === 'uniq_approval_resolved_per_step') {
      logger.debug('task_event_duplicate_approval_resolved', {
        taskId: ctx.taskId,
        eventKind: event.kind,
      });
      return;
    }
    throw err;
  }

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
