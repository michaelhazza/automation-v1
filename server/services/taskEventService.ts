/**
 * taskEventService.ts — write path for task-scoped execution events.
 *
 * appendAndEmit:
 *   1. Validates the event payload via validateTaskEvent.
 *   2. Allocates a per-task sequence number from tasks.next_event_seq.
 *   3. If runId is provided, allocates a per-run sequence from agent_runs.next_event_seq.
 *      If runId is null (pause/resume/stop/pool-refresh paths), skips that allocation
 *      and INSERTs with sequence_number = null.
 *   4. INSERTs a row into agent_execution_events with task_id set.
 *   5. Emits via emitTaskEvent AFTER the DB write.
 *
 * runId is nullable since migration 0270: task-scoped events without an owning agent run
 * (pause/resume/stop/pool-refresh) pass null. The DB check constraint enforces that
 * at least one of (run_id, task_id) is set.
 *
 * Spec: docs/workflows-dev-spec.md §8.
 */

import { eq, sql, and, asc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import type { OrgScopedTx } from '../db/index.js';
import { agentExecutionEvents } from '../db/schema/agentExecutionEvents.js';
import { agentRuns } from '../db/schema/agentRuns.js';
import { tasks } from '../db/schema/tasks.js';
import { logger } from '../lib/logger.js';
import { validateTaskEvent } from '../../shared/types/taskEventValidator.js';
import type { TaskEvent, TaskEventEnvelope } from '../../shared/types/taskEvent.js';
import { emitTaskEvent } from '../websocket/emitters.js';
import { incrementCounter } from '../lib/metrics.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface AppendAndEmitInput {
  taskId: string;
  /**
   * FK to agent_runs.id. Required for engine/gate emissions that have a real agent run.
   * Pass null for workflow-run-scoped events (pause/resume/stop/pool-refresh) that have
   * no agent_run context — the INSERT will set run_id = NULL and skip sequence allocation
   * from agent_runs. The DB check constraint (run_id IS NOT NULL OR task_id IS NOT NULL)
   * is satisfied by task_id being set.
   */
  runId: string | null;
  organisationId: string;
  eventOrigin: 'engine' | 'gate' | 'user' | 'orchestrator';
  event: TaskEvent;
  /**
   * If the engine has already opened a transaction, pass it here so the
   * sequence allocation and INSERT are atomic with the caller's writes.
   */
  tx?: OrgScopedTx;
  /**
   * Per-bundle subsequence within the same logical step transition.
   * Defaults to 0. Callers emitting multiple events for the same step
   * transition are responsible for incrementing.
   */
  eventSubsequence?: number;
}

export interface AppendAndEmitResult {
  taskSequence: number;
  eventSubsequence: number;
  /**
   * Emit the WebSocket event. When appendAndEmit was called WITHOUT input.tx,
   * the DB write is already committed and emit is invoked synchronously before
   * returning — the caller can ignore this function.
   *
   * When appendAndEmit was called WITH input.tx (engine path), the INSERT runs
   * inside the caller's open transaction. The caller MUST invoke this function
   * AFTER their transaction commits to avoid emitting phantom events for rows
   * that may never materialise. If the transaction rolls back, do NOT call emit.
   */
  emit: () => Promise<void>;
}

export const TaskEventService = {
  /**
   * Validate, persist, and emit a single task-scoped event.
   *
   * Throws with `{ statusCode: 400, errorCode: 'invalid_payload' }` on
   * validation failure — no row is written, no emit.
   *
   * Emit failures are caught and logged; the row is still in the DB and
   * replays on reconnect will re-deliver the event.
   */
  async appendAndEmit(input: AppendAndEmitInput): Promise<AppendAndEmitResult> {
    // ── 1. Validate ───────────────────────────────────────────────────────
    const validation = validateTaskEvent({ kind: input.event.kind, payload: input.event.payload });
    if (!validation.ok) {
      logger.error('task_event_invalid_payload', {
        event: 'task_event.invalid_payload',
        taskId: input.taskId,
        runId: input.runId ?? null,
        kind: (input.event as { kind?: unknown }).kind,
        reason: validation.reason,
      });
      throw {
        statusCode: 400,
        message: 'Invalid task event payload',
        errorCode: 'invalid_payload',
        reason: validation.reason,
      };
    }

    const eventSubsequence = input.eventSubsequence ?? 0;
    const eventTimestamp = new Date();

    let taskSequence!: number;
    let rowTimestamp!: Date;

    // ── 2–3. Persist (inside caller tx or new transaction) ────────────────
    const doWrite = async (writer: typeof db): Promise<void> => {
      // Allocate per-task monotonic sequence from tasks.next_event_seq.
      const taskRows = await writer
        .update(tasks)
        .set({ nextEventSeq: sql`${tasks.nextEventSeq} + 1` })
        .where(eq(tasks.id, input.taskId))
        .returning({ nextEventSeq: tasks.nextEventSeq });

      if (taskRows.length === 0) {
        throw new Error(`tasks row missing for taskId=${input.taskId}`);
      }
      taskSequence = taskRows[0].nextEventSeq;

      // Allocate per-run monotonic sequence from agent_runs.next_event_seq only
      // when runId is set. Task-only events (pause/resume/stop/pool-refresh) have
      // no agent_run context; they insert with sequence_number = null.
      // The partial index on (run_id, sequence_number) WHERE run_id IS NOT NULL
      // means null sequence_number rows are never indexed into that slot.
      let runSequence: number | null = null;
      if (input.runId !== null) {
        const runRows = await writer
          .update(agentRuns)
          .set({ nextEventSeq: sql`${agentRuns.nextEventSeq} + 1` })
          .where(eq(agentRuns.id, input.runId))
          .returning({ nextEventSeq: agentRuns.nextEventSeq });

        if (runRows.length === 0) {
          throw new Error(`agent_runs row missing for runId=${input.runId}`);
        }
        runSequence = runRows[0].nextEventSeq;
      }

      const [inserted] = await writer
        .insert(agentExecutionEvents)
        .values({
          id: randomUUID(),
          runId: input.runId ?? undefined,
          organisationId: input.organisationId,
          sequenceNumber: runSequence ?? undefined,
          eventType: input.event.kind,
          eventTimestamp,
          durationSinceRunStartMs: 0,
          sourceService: 'taskEventService',
          payload: {
            kind: input.event.kind,
            payload: input.event.payload,
          } as unknown as Record<string, unknown>,
          taskId: input.taskId,
          taskSequence,
          eventOrigin: input.eventOrigin,
          eventSubsequence,
          eventSchemaVersion: 1,
        })
        .returning({
          id: agentExecutionEvents.id,
          eventTimestamp: agentExecutionEvents.eventTimestamp,
        });

      rowTimestamp = inserted.eventTimestamp ?? eventTimestamp;
    };

    if (input.tx) {
      await doWrite(input.tx as unknown as typeof db);
    } else {
      await db.transaction(async (tx) => {
        await doWrite(tx as unknown as typeof db);
      });
    }

    // ── 4. Build the emit closure ─────────────────────────────────────────
    // When called WITHOUT input.tx: the transaction has already committed by
    // the time we reach here, so we invoke emit immediately.
    // When called WITH input.tx: the caller's transaction is still open. We
    // return the closure so the caller can invoke it AFTER their tx commits.
    // Invoking before commit risks emitting phantom events for rolled-back rows.
    const emitFn = async (): Promise<void> => {
      try {
        const envelope: TaskEventEnvelope = {
          eventId: `task:${input.taskId}:${taskSequence}:${eventSubsequence}:${input.event.kind}`,
          type: 'task:execution-event',
          entityId: input.taskId,
          timestamp: rowTimestamp.toISOString(),
          eventOrigin: input.eventOrigin,
          taskSequence,
          eventSubsequence,
          eventSchemaVersion: 1,
          payload: input.event,
        };
        emitTaskEvent(envelope);
      } catch (emitErr) {
        // WebSocket emission failure is non-fatal — the row is in the DB
        // and the client can replay on reconnect.
        logger.warn('task_event_emit_failed', {
          event: 'task_event.emit_failed',
          taskId: input.taskId,
          taskSequence,
          kind: input.event.kind,
          error: emitErr instanceof Error ? emitErr.message : String(emitErr),
        });
      }
    };

    if (!input.tx) {
      // No caller tx — already committed above; emit immediately.
      await emitFn();
    }
    // If input.tx is set, caller must invoke result.emit() after their tx commits.

    return { taskSequence, eventSubsequence, emit: emitFn };
  },

  /**
   * Fetch events after a cursor for replay.
   *
   * Returns up to PAGE_SIZE events with (task_sequence, event_subsequence) >
   * (fromSeq, fromSubseq), plus gap metadata and a nextCursor when more rows
   * remain. Callers should loop until nextCursor is null.
   */
  async getEventsForReplay(input: {
    taskId: string;
    organisationId: string;
    fromSeq: number;
    fromSubseq: number;
  }): Promise<{
    events: TaskEventEnvelope[];
    hasGap: boolean;
    oldestRetainedSeq: number;
    nextCursor: { fromSeq: number; fromSubseq: number } | null;
  }> {
    // Find the oldest retained sequence for gap detection
    const [oldestRow] = await db
      .select({ taskSequence: agentExecutionEvents.taskSequence })
      .from(agentExecutionEvents)
      .where(
        and(
          eq(agentExecutionEvents.taskId, input.taskId),
          eq(agentExecutionEvents.organisationId, input.organisationId),
        )
      )
      .orderBy(asc(agentExecutionEvents.taskSequence))
      .limit(1);

    const oldestRetainedSeq = oldestRow?.taskSequence ?? 0;

    // Gap: client cursor is non-zero but falls before our oldest retained row
    const hasGap = input.fromSeq > 0 && input.fromSeq < oldestRetainedSeq;

    // B4: Limit replay to PAGE_SIZE rows to prevent OOM on long-running tasks.
    // Callers follow nextCursor until null to get all events.
    const PAGE_SIZE = 1000;

    // Fetch PAGE_SIZE + 1 rows so we can detect if there are more.
    const rows = await db
      .select()
      .from(agentExecutionEvents)
      .where(
        and(
          eq(agentExecutionEvents.taskId, input.taskId),
          eq(agentExecutionEvents.organisationId, input.organisationId),
          sql`(${agentExecutionEvents.taskSequence}, COALESCE(${agentExecutionEvents.eventSubsequence}, 0)) > (${input.fromSeq}, ${input.fromSubseq})`,
        )
      )
      .orderBy(
        asc(agentExecutionEvents.taskSequence),
        asc(agentExecutionEvents.eventSubsequence),
      )
      .limit(PAGE_SIZE + 1);

    const hasMore = rows.length > PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

    const events: TaskEventEnvelope[] = pageRows.map((row) => {
      const rawPayload = row.payload as { kind?: string; payload?: unknown } | null;
      const kind = (rawPayload?.kind ?? row.eventType) as string;
      const innerPayload = rawPayload?.payload ?? rawPayload ?? {};

      return {
        eventId: `task:${input.taskId}:${row.taskSequence ?? 0}:${row.eventSubsequence ?? 0}:${kind}`,
        type: 'task:execution-event',
        entityId: input.taskId,
        timestamp: row.eventTimestamp.toISOString(),
        eventOrigin: (row.eventOrigin ?? 'engine') as TaskEventEnvelope['eventOrigin'],
        taskSequence: row.taskSequence ?? 0,
        eventSubsequence: row.eventSubsequence ?? 0,
        eventSchemaVersion: row.eventSchemaVersion ?? 1,
        payload: { kind, payload: innerPayload } as unknown as TaskEvent,
      };
    });

    // Build nextCursor from the last event in the page when there are more rows.
    const lastEvent = events[events.length - 1];
    const nextCursor: { fromSeq: number; fromSubseq: number } | null =
      hasMore && lastEvent
        ? { fromSeq: lastEvent.taskSequence, fromSubseq: lastEvent.eventSubsequence }
        : null;

    return { events, hasGap, oldestRetainedSeq, nextCursor };
  },
};

// ─── Observability counters ───────────────────────────────────────────────────

export function recordGapDetected(organisationId: string): void {
  incrementCounter('task_event_gap_detected_total', { organisation_id: organisationId });
}

export function recordSubsequenceCollision(organisationId: string): void {
  incrementCounter('task_event_subsequence_collision_total', { organisation_id: organisationId });
}
