// Live Agent Execution Log — event emission + snapshot reads.
// Spec: tasks/live-agent-execution-log-spec.md §4.1, §4.3, §5.1, §5.9, §6.2.

import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import type {
  AgentExecutionEvent,
  AgentExecutionEventEnvelope,
  AgentExecutionEventPage,
  AgentExecutionEventPayload,
  AgentExecutionSourceService,
  AgentRunLlmPayload,
  AgentRunPrompt,
  EventOrigin,
  LinkedEntity,
  LinkedEntityType,
  PayloadModification,
  PayloadRedaction,
  PermissionMask,
} from '../../shared/types/agentExecutionLog.js';
import { agentExecutionEvents } from '../db/schema/agentExecutionEvents.js';
import { agentRunLlmPayloads } from '../db/schema/agentRunLlmPayloads.js';
import { agentRunPrompts } from '../db/schema/agentRunPrompts.js';
import { agentRuns } from '../db/schema/agentRuns.js';
import { tasks } from '../db/schema/tasks.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { getIO } from '../websocket/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  buildEventId,
  computeDurationSinceRunStartMs,
  isCriticalEventType,
  validateEventPayload,
  validateLinkedEntity,
  type LinkedEntityRef,
} from './agentExecutionEventServicePure.js';
import {
  buildPermissionMask,
  resolveLinkedEntityLabels,
  type PermissionMaskUserContext,
} from '../lib/agentRunEditPermissionMask.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppendEventInput {
  runId: string;
  organisationId: string;
  subaccountId: string | null;
  payload: AgentExecutionEventPayload;
  sourceService: AgentExecutionSourceService;
  linkedEntity?: LinkedEntityRef;
  // Workflows V1 — per-task event log (Chunk 3)
  taskId?: string | null;
  eventOrigin?: EventOrigin | null;
  eventSubsequence?: number;
}

export interface StreamEventsOptions {
  fromSeq?: number;
  limit?: number;
  forUser: PermissionMaskUserContext;
}

// ---------------------------------------------------------------------------
// insertExecutionEventSafe — delegation-error dual-write entry point (INV-3)
// ---------------------------------------------------------------------------

/**
 * Best-effort delegation-error event write. INV-3 companion to insertOutcomeSafe.
 * On failure: WARN tag `delegation_event_write_failed`, returns without throwing.
 * Skill handlers call this; never call appendEvent directly for delegation errors.
 */
export async function insertExecutionEventSafe(input: AppendEventInput): Promise<void> {
  try {
    await appendEvent(input);
  } catch (err) {
    logger.warn('delegation_event_write_failed', {
      runId: input.runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Retry + metrics
// ---------------------------------------------------------------------------

const CRITICAL_RETRY_BACKOFF_MS = 50;

// Lightweight in-memory counters — operational dashboards scrape these.
// Spec §4.1 names the metrics as `agent_exec_log.critical_drops_total` /
// `noncritical_drops_total` / `cap_drops_total`. For P1 we expose them
// through the existing logger pipeline (structured events) — a Prometheus
// exporter is orthogonal and not blocking on this spec.
let criticalDropsTotal = 0;
let nonCriticalDropsTotal = 0;
let capDropsTotal = 0;

export function getAgentExecutionLogMetrics(): {
  criticalDropsTotal: number;
  nonCriticalDropsTotal: number;
  capDropsTotal: number;
} {
  return {
    criticalDropsTotal,
    nonCriticalDropsTotal,
    capDropsTotal,
  };
}

// ---------------------------------------------------------------------------
// Append — the hot path
// ---------------------------------------------------------------------------

export async function appendEvent(input: AppendEventInput): Promise<void> {
  const eventType = input.payload.eventType;

  // Validate payload shape before touching the DB — fail fast, never
  // persist a broken row.
  const validation = validateEventPayload(eventType, input.payload);
  if (!validation.ok) {
    logger.warn('agentExecutionEventService.payload_invalid', {
      runId: input.runId,
      eventType,
      reason: validation.reason,
    });
    return;
  }

  const linkedCheck = validateLinkedEntity(input.linkedEntity);
  if (!linkedCheck.ok) {
    logger.warn('agentExecutionEventService.linked_entity_invalid', {
      runId: input.runId,
      eventType,
      reason: linkedCheck.reason,
    });
    return;
  }
  const linkedEntity = linkedCheck.normalised;

  const critical = isCriticalEventType(eventType);
  const maxEvents = env.AGENT_EXECUTION_LOG_MAX_EVENTS_PER_RUN;

  // Critical events get exactly one retry with fixed 50 ms backoff (spec §4.1).
  const maxAttempts = critical ? 2 : 1;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const persisted = await persistEvent(input, linkedEntity, critical, maxEvents);
      if (!persisted) {
        // Capped — non-critical short-circuit; no emit; metric already incremented.
        return;
      }
      emitEnvelope(persisted);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await sleep(CRITICAL_RETRY_BACKOFF_MS);
      }
    }
  }

  if (critical) {
    criticalDropsTotal += 1;
    logger.error('agentExecutionEventService.critical_event_dropped', {
      runId: input.runId,
      eventType,
      err: (lastErr as Error | undefined)?.message ?? String(lastErr),
    });
  } else {
    nonCriticalDropsTotal += 1;
    logger.warn('agentExecutionEventService.append_failed', {
      runId: input.runId,
      eventType,
      err: (lastErr as Error | undefined)?.message ?? String(lastErr),
    });
  }
}

// ---------------------------------------------------------------------------
// Persist helpers
// ---------------------------------------------------------------------------

interface PersistedEvent {
  event: AgentExecutionEvent;
  socketUser: PermissionMaskUserContext | null;
}

/**
 * Allocate a sequence number against agent_runs.next_event_seq and write
 * the row. Returns `null` when a non-critical event is capped.
 *
 * When `input.taskId` is provided, the per-run sequence allocation
 * (UPDATE agent_runs), the per-task sequence allocation (UPDATE tasks), and
 * the event INSERT all run inside a single transaction so that all three
 * either commit or roll back together. This prevents per-run sequence gaps
 * when the per-task transaction rolls back.
 */
async function persistEvent(
  input: AppendEventInput,
  linkedEntity: LinkedEntityRef,
  critical: boolean,
  maxEvents: number,
): Promise<PersistedEvent | null> {
  const db = getOrgScopedDb('agentExecutionEventService.appendEvent');

  const taskId = input.taskId ?? null;
  const eventOrigin = input.eventOrigin ?? null;
  const eventSubsequence = input.eventSubsequence ?? 0;

  let rowId: string;
  let rowEventTimestamp: Date;
  let taskSequence: number | null = null;
  let nextSeq: number;
  let durationSinceRunStartMs: number;

  if (taskId) {
    // ── Per-task path: single transaction for per-run seq + per-task seq + insert ──
    //
    // All three operations commit or roll back together, preventing gaps in
    // the per-run sequence when the per-task transaction rolls back (S3).
    const result = await db.transaction(async (tx) => {
      // Allocate per-run sequence number inside the transaction.
      let runRows: Array<{ nextEventSeq: number; startedAt: Date | null }>;
      if (critical) {
        runRows = await tx
          .update(agentRuns)
          .set({
            nextEventSeq: sql`${agentRuns.nextEventSeq} + 1`,
            lastActivityAt: new Date(),
          })
          .where(eq(agentRuns.id, input.runId))
          .returning({
            nextEventSeq: agentRuns.nextEventSeq,
            startedAt: agentRuns.startedAt,
          });
        if (runRows.length === 0) {
          throw new Error(`agent_runs row missing for runId=${input.runId}`);
        }
      } else {
        runRows = await tx
          .update(agentRuns)
          .set({
            nextEventSeq: sql`${agentRuns.nextEventSeq} + 1`,
            lastActivityAt: new Date(),
          })
          .where(
            and(
              eq(agentRuns.id, input.runId),
              sql`${agentRuns.nextEventSeq} < ${maxEvents}`,
            ),
          )
          .returning({
            nextEventSeq: agentRuns.nextEventSeq,
            startedAt: agentRuns.startedAt,
          });
        if (runRows.length === 0) {
          // Non-critical event hit the cap — signal will be emitted after
          // the transaction returns null.
          return null;
        }
      }

      const allocatedRunSeq = runRows[0].nextEventSeq;
      const runStartedAt = runRows[0].startedAt;

      // Allocate per-task sequence number.
      // Allocation: allocateTaskSequence(current) returns { allocated: current + 1 }.
      // The UPDATE's RETURNING value is the allocated sequence number.
      // See server/services/agentExecutionEventTaskSequencePure.ts for the pure helper.
      const taskRows = await tx
        .update(tasks)
        .set({ nextEventSeq: sql`${tasks.nextEventSeq} + 1` })
        .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, input.organisationId)))
        .returning({ nextEventSeq: tasks.nextEventSeq });

      if (taskRows.length === 0) {
        throw new Error(`tasks row missing for taskId=${taskId}`);
      }
      const allocatedTaskSeq = taskRows[0].nextEventSeq;

      const eventTimestamp = new Date();
      const startedAtMs = runStartedAt ? runStartedAt.getTime() : eventTimestamp.getTime();
      const durMs = computeDurationSinceRunStartMs(startedAtMs, eventTimestamp.getTime());

      const [inserted] = await tx
        .insert(agentExecutionEvents)
        .values({
          id: randomUUID(),
          runId: input.runId,
          organisationId: input.organisationId,
          subaccountId: input.subaccountId,
          sequenceNumber: allocatedRunSeq,
          eventType: input.payload.eventType,
          eventTimestamp,
          durationSinceRunStartMs: durMs,
          sourceService: input.sourceService,
          payload: input.payload as unknown as Record<string, unknown>,
          linkedEntityType: linkedEntity?.type ?? null,
          linkedEntityId: linkedEntity?.id ?? null,
          taskId,
          taskSequence: allocatedTaskSeq,
          eventOrigin,
          eventSubsequence,
          eventSchemaVersion: 1,
        })
        .returning({
          id: agentExecutionEvents.id,
          eventTimestamp: agentExecutionEvents.eventTimestamp,
        });

      return { inserted, allocatedTaskSeq, allocatedRunSeq, durMs, eventTimestamp };
    });

    if (result === null) {
      // Non-critical cap hit — drop and possibly emit limit signal.
      capDropsTotal += 1;
      await emitEventLimitReachedIfFirst(input.runId, input.organisationId, input.subaccountId, maxEvents);
      return null;
    }

    rowId = result.inserted.id;
    rowEventTimestamp = result.inserted.eventTimestamp ?? result.eventTimestamp;
    taskSequence = result.allocatedTaskSeq;
    nextSeq = result.allocatedRunSeq;
    durationSinceRunStartMs = result.durMs;
  } else {
    // ── Non-task path: allocate per-run sequence number standalone ────────
    //
    // Critical events bypass the cap so lifecycle bookends always emit.
    // Non-critical events use the `< $cap` guard — empty RETURNING means we
    // short-circuit.
    let runStartedAt: Date | null;
    if (critical) {
      const rows = await db
        .update(agentRuns)
        .set({
          nextEventSeq: sql`${agentRuns.nextEventSeq} + 1`,
          lastActivityAt: new Date(),
        })
        .where(eq(agentRuns.id, input.runId))
        .returning({
          nextEventSeq: agentRuns.nextEventSeq,
          startedAt: agentRuns.startedAt,
        });
      if (rows.length === 0) {
        throw new Error(`agent_runs row missing for runId=${input.runId}`);
      }
      nextSeq = rows[0].nextEventSeq;
      runStartedAt = rows[0].startedAt;
    } else {
      const rows = await db
        .update(agentRuns)
        .set({
          nextEventSeq: sql`${agentRuns.nextEventSeq} + 1`,
          lastActivityAt: new Date(),
        })
        .where(
          and(
            eq(agentRuns.id, input.runId),
            sql`${agentRuns.nextEventSeq} < ${maxEvents}`,
          ),
        )
        .returning({
          nextEventSeq: agentRuns.nextEventSeq,
          startedAt: agentRuns.startedAt,
        });
      if (rows.length === 0) {
        // Non-critical event hit the cap — drop + possibly emit the
        // one-shot run.event_limit_reached signal.
        capDropsTotal += 1;
        await emitEventLimitReachedIfFirst(input.runId, input.organisationId, input.subaccountId, maxEvents);
        return null;
      }
      nextSeq = rows[0].nextEventSeq;
      runStartedAt = rows[0].startedAt;
    }

    const eventTimestamp = new Date();
    const startedAtMs = runStartedAt ? runStartedAt.getTime() : eventTimestamp.getTime();
    durationSinceRunStartMs = computeDurationSinceRunStartMs(
      startedAtMs,
      eventTimestamp.getTime(),
    );
    // ── Insert the event row (non-task path) ──────────────────────────
    const [row] = await db
      .insert(agentExecutionEvents)
      .values({
        id: randomUUID(),
        runId: input.runId,
        organisationId: input.organisationId,
        subaccountId: input.subaccountId,
        sequenceNumber: nextSeq,
        eventType: input.payload.eventType,
        eventTimestamp,
        durationSinceRunStartMs,
        sourceService: input.sourceService,
        payload: input.payload as unknown as Record<string, unknown>,
        linkedEntityType: linkedEntity?.type ?? null,
        linkedEntityId: linkedEntity?.id ?? null,
      })
      .returning({
        id: agentExecutionEvents.id,
        eventTimestamp: agentExecutionEvents.eventTimestamp,
      });

    rowId = row.id;
    rowEventTimestamp = row.eventTimestamp ?? eventTimestamp;
  }

  // Construct the wire event for the emit step (permissionMask is
  // applied per-socket inside emitEnvelope).
  const event: AgentExecutionEvent = {
    id: rowId,
    runId: input.runId,
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    sequenceNumber: nextSeq!,
    eventType: input.payload.eventType,
    eventTimestamp: rowEventTimestamp.toISOString(),
    durationSinceRunStartMs,
    sourceService: input.sourceService,
    payload: input.payload,
    linkedEntity: linkedEntity
      ? { type: linkedEntity.type, id: linkedEntity.id, label: '' }
      : null,
    permissionMask: EMPTY_MASK,
    taskId,
    taskSequence,
    eventOrigin,
    eventSubsequence,
    eventSchemaVersion: 1,
  };

  return { event, socketUser: null };
}

// ---------------------------------------------------------------------------
// One-shot run.event_limit_reached — atomic-claim pattern (spec §4.1)
// ---------------------------------------------------------------------------

async function emitEventLimitReachedIfFirst(
  runId: string,
  organisationId: string,
  subaccountId: string | null,
  cap: number,
): Promise<void> {
  // The atomic-claim UPDATE and the signal-event INSERT must commit or
  // rollback together. If the UPDATE committed but the INSERT rolled
  // back, the `event_limit_reached_emitted` flag would be set with no
  // corresponding event row — losing the signal permanently (no retry,
  // because the flag now blocks re-entry).
  const db = getOrgScopedDb('agentExecutionEventService.eventLimitReached');
  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .update(agentRuns)
      .set({
        eventLimitReachedEmitted: true,
        nextEventSeq: sql`${agentRuns.nextEventSeq} + 1`,
      })
      .where(
        and(
          eq(agentRuns.id, runId),
          eq(agentRuns.eventLimitReachedEmitted, false),
        ),
      )
      .returning({
        nextEventSeq: agentRuns.nextEventSeq,
        startedAt: agentRuns.startedAt,
      });

    if (rows.length === 0) {
      // Another caller already claimed the emission — nothing to do.
      return null;
    }

    const nextSeq = rows[0].nextEventSeq;
    const startedAt = rows[0].startedAt ?? new Date();
    const eventTimestamp = new Date();
    const durationMs = computeDurationSinceRunStartMs(
      startedAt.getTime(),
      eventTimestamp.getTime(),
    );
    const payload: AgentExecutionEventPayload = {
      eventType: 'run.event_limit_reached',
      critical: true,
      eventCountAtLimit: nextSeq - 1,
      cap,
    };

    const [row] = await tx
      .insert(agentExecutionEvents)
      .values({
        id: randomUUID(),
        runId,
        organisationId,
        subaccountId,
        sequenceNumber: nextSeq,
        eventType: 'run.event_limit_reached',
        eventTimestamp,
        durationSinceRunStartMs: durationMs,
        sourceService: 'agentExecutionService',
        payload: payload as unknown as Record<string, unknown>,
        linkedEntityType: null,
        linkedEntityId: null,
      })
      .returning({ id: agentExecutionEvents.id });

    return { row, nextSeq, eventTimestamp, durationMs, payload };
  });

  if (!result) return;
  const { row, nextSeq, eventTimestamp, durationMs, payload } = result;

  const event: AgentExecutionEvent = {
    id: row.id,
    runId,
    organisationId,
    subaccountId,
    sequenceNumber: nextSeq,
    eventType: 'run.event_limit_reached',
    eventTimestamp: eventTimestamp.toISOString(),
    durationSinceRunStartMs: durationMs,
    sourceService: 'agentExecutionService',
    payload,
    linkedEntity: null,
    permissionMask: EMPTY_MASK,
    taskId: null,
    taskSequence: null,
    eventOrigin: null,
    eventSubsequence: 0,
    eventSchemaVersion: 1,
  };

  emitEnvelope({ event, socketUser: null });
}

// ---------------------------------------------------------------------------
// Emit — permissionMask is computed per-socket at emit time
// ---------------------------------------------------------------------------

const EMPTY_MASK: PermissionMask = {
  canView: false,
  canEdit: false,
  canViewPayload: false,
  viewHref: null,
  editHref: null,
};

function emitEnvelope(persisted: PersistedEvent): void {
  const io = getIO();
  if (!io) return;

  const envelope: AgentExecutionEventEnvelope = {
    eventId: buildEventId(
      persisted.event.runId,
      persisted.event.sequenceNumber,
      persisted.event.eventType,
    ),
    type: 'agent-run:execution-event',
    entityId: persisted.event.runId,
    timestamp: persisted.event.eventTimestamp,
    payload: persisted.event,
  };

  // No per-socket mask computation in P1 — emit the empty mask on the
  // wire and let the client re-query the snapshot endpoint for a
  // permission-bearing view. Socket-user tracking is wired on the room-
  // join handler side (see server/websocket/rooms.ts) — ensuring the
  // socket is authorised to be in the room is the bar; mask rendering
  // in the live stream can be a follow-up without changing the shape of
  // the socket envelope.
  io.to(`agent-run:${persisted.event.runId}`).emit(envelope.type, envelope);
}

// ---------------------------------------------------------------------------
// Snapshot read
// ---------------------------------------------------------------------------

export interface StreamEventsResult {
  page: AgentExecutionEventPage;
}

export async function streamEvents(
  runId: string,
  opts: StreamEventsOptions,
): Promise<AgentExecutionEventPage> {
  const db = getOrgScopedDb('agentExecutionEventService.streamEvents');
  const fromSeq = Math.max(1, opts.fromSeq ?? 1);
  const limit = Math.min(Math.max(1, opts.limit ?? 1000), 1000);

  const rows = await db
    .select()
    .from(agentExecutionEvents)
    .where(
      and(
        eq(agentExecutionEvents.runId, runId),
        gte(agentExecutionEvents.sequenceNumber, fromSeq),
      ),
    )
    .orderBy(asc(agentExecutionEvents.sequenceNumber))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // ── Batch label + permission resolution (spec §5.9) ───────────────────
  const labelMap = await resolveLinkedEntityLabels(
    collectLinkedEntityIds(page),
  );

  const events: AgentExecutionEvent[] = page.map((row) => {
    const linkedEntity =
      row.linkedEntityType && row.linkedEntityId
        ? ({
            type: row.linkedEntityType as LinkedEntityType,
            id: row.linkedEntityId,
            label:
              labelMap[`${row.linkedEntityType}:${row.linkedEntityId}`] ??
              `${row.linkedEntityType} ${row.linkedEntityId}`,
          } as LinkedEntity)
        : null;

    const permissionMask = buildPermissionMask({
      entityType: linkedEntity?.type ?? null,
      entityId: linkedEntity?.id ?? null,
      user: opts.forUser,
      runOrganisationId: row.organisationId,
      runSubaccountId: row.subaccountId,
    });

    return {
      id: row.id,
      runId: row.runId,
      organisationId: row.organisationId,
      subaccountId: row.subaccountId,
      sequenceNumber: row.sequenceNumber,
      eventType: row.eventType as AgentExecutionEvent['eventType'],
      eventTimestamp: row.eventTimestamp.toISOString(),
      durationSinceRunStartMs: row.durationSinceRunStartMs,
      sourceService: row.sourceService as AgentExecutionSourceService,
      payload: row.payload as unknown as AgentExecutionEventPayload,
      linkedEntity,
      permissionMask,
      taskId: row.taskId ?? null,
      taskSequence: row.taskSequence ?? null,
      eventOrigin: (row.eventOrigin ?? null) as EventOrigin | null,
      eventSubsequence: row.eventSubsequence,
      eventSchemaVersion: row.eventSchemaVersion,
    };
  });

  const highestSequenceNumber =
    events.length > 0 ? events[events.length - 1].sequenceNumber : fromSeq - 1;

  const highestTaskSequence = events.reduce<number | null>((acc, e) => {
    if (e.taskSequence == null) return acc;
    return acc == null ? e.taskSequence : Math.max(acc, e.taskSequence);
  }, null);

  return { events, hasMore, highestSequenceNumber, highestTaskSequence };
}

// ---------------------------------------------------------------------------
// Per-task snapshot read
// ---------------------------------------------------------------------------

/**
 * Paginate events scoped to a single task.
 * Ordered by (task_sequence ASC, event_subsequence ASC).
 * Composite cursor: only returns rows where
 *   (task_sequence, event_subsequence) > (fromSeq, fromSubseq).
 */
export async function streamEventsByTask(
  taskId: string,
  opts: StreamEventsOptions & { fromSeq?: number; fromSubseq?: number },
): Promise<AgentExecutionEventPage> {
  const db = getOrgScopedDb('agentExecutionEventService.streamEventsByTask');
  const fromSeq = opts.fromSeq ?? 0;
  const fromSubseq = opts.fromSubseq ?? 0;
  const limit = Math.min(Math.max(1, opts.limit ?? 1000), 1000);

  const rows = await db
    .select()
    .from(agentExecutionEvents)
    .where(
      and(
        eq(agentExecutionEvents.taskId, taskId),
        sql`(${agentExecutionEvents.taskSequence}, ${agentExecutionEvents.eventSubsequence}) > (${fromSeq}, ${fromSubseq})`,
      ),
    )
    .orderBy(
      asc(agentExecutionEvents.taskSequence),
      asc(agentExecutionEvents.eventSubsequence),
    )
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const labelMap = await resolveLinkedEntityLabels(
    collectLinkedEntityIds(page),
  );

  const events: AgentExecutionEvent[] = page.map((row) => {
    const linkedEntity =
      row.linkedEntityType && row.linkedEntityId
        ? ({
            type: row.linkedEntityType as LinkedEntityType,
            id: row.linkedEntityId,
            label:
              labelMap[`${row.linkedEntityType}:${row.linkedEntityId}`] ??
              `${row.linkedEntityType} ${row.linkedEntityId}`,
          } as LinkedEntity)
        : null;

    const permissionMask = buildPermissionMask({
      entityType: linkedEntity?.type ?? null,
      entityId: linkedEntity?.id ?? null,
      user: opts.forUser,
      runOrganisationId: row.organisationId,
      runSubaccountId: row.subaccountId,
    });

    return {
      id: row.id,
      runId: row.runId,
      organisationId: row.organisationId,
      subaccountId: row.subaccountId,
      sequenceNumber: row.sequenceNumber,
      eventType: row.eventType as AgentExecutionEvent['eventType'],
      eventTimestamp: row.eventTimestamp.toISOString(),
      durationSinceRunStartMs: row.durationSinceRunStartMs,
      sourceService: row.sourceService as AgentExecutionSourceService,
      payload: row.payload as unknown as AgentExecutionEventPayload,
      linkedEntity,
      permissionMask,
      taskId: row.taskId ?? null,
      taskSequence: row.taskSequence ?? null,
      eventOrigin: (row.eventOrigin ?? null) as EventOrigin | null,
      eventSubsequence: row.eventSubsequence,
      eventSchemaVersion: row.eventSchemaVersion,
    };
  });

  const highestTaskSequence = events.length === 0
    ? null
    : events.reduce<number | null>((acc, e) => {
        if (e.taskSequence == null) return acc;
        return acc == null ? e.taskSequence : Math.max(acc, e.taskSequence);
      }, null);

  // highestSequenceNumber uses the per-run sequence of the last event in page.
  const highestSequenceNumber =
    events.length > 0 ? events[events.length - 1].sequenceNumber : 0;

  return { events, hasMore, highestSequenceNumber, highestTaskSequence };
}

// ---------------------------------------------------------------------------
// Bundle write — one task-sequence slot, multiple sub-sequence events
// ---------------------------------------------------------------------------

export interface BundleEventInput {
  origin: EventOrigin;
  payload: AgentExecutionEventPayload;
  sourceService: AgentExecutionSourceService;
  linkedEntity?: LinkedEntityRef;
}

/**
 * Write a bundle of events atomically, allocating a single task_sequence for
 * all of them. Each event gets event_subsequence = i (0-indexed).
 *
 * The `tx` parameter must be a Drizzle transaction handle (OrgScopedTx).
 * Pass the tx from the engine's outer transaction so that the entire bundle
 * commits or rolls back together.
 *
 * If no tx is passed, the function acquires its own transaction via the
 * org-scoped db.
 */
export async function appendEventBundle(
  input: {
    runId: string;
    organisationId: string;
    subaccountId: string | null;
    taskId: string;
    events: BundleEventInput[];
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx?: any,
): Promise<void> {
  if (input.events.length === 0) return;

  // S1: Validate all event payloads and linked entities before any DB writes.
  // Collect normalised linked entities so the INSERT uses validated + normalised
  // values rather than raw caller input (Issue 1).
  const normalisedLinkedEntities: Array<ReturnType<typeof validateLinkedEntity> & { ok: true }> = [];
  for (const e of input.events) {
    const validation = validateEventPayload(e.payload.eventType, e.payload);
    if (!validation.ok) {
      logger.warn('agentExecutionEventService.bundle_payload_invalid', {
        runId: input.runId,
        eventType: e.payload.eventType,
        reason: validation.reason,
      });
      return;
    }
    const linkedCheck = validateLinkedEntity(e.linkedEntity);
    if (!linkedCheck.ok) {
      logger.warn('agentExecutionEventService.bundle_linked_entity_invalid', {
        runId: input.runId,
        eventType: e.payload.eventType,
        reason: linkedCheck.reason,
      });
      return;
    }
    normalisedLinkedEntities.push(linkedCheck as ReturnType<typeof validateLinkedEntity> & { ok: true });
  }

  const count = input.events.length;
  const db = getOrgScopedDb('agentExecutionEventService.appendEventBundle');
  const run = async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    executor: any,
  ): Promise<void> => {
    // Bundle events are causality-boundary writes (step transitions, gate lifecycle, run lifecycle).
    // They bypass the per-run non-critical cap — these events must always land.
    // See plan §Chunk 3 "appendEventBundle" and §causality-boundary invariant.
    //
    // B1: Allocate a contiguous range of per-run sequence numbers for the
    // entire bundle in one UPDATE, then stamp each event with start + i + 1.
    const runRows = await executor
      .update(agentRuns)
      .set({
        nextEventSeq: sql`${agentRuns.nextEventSeq} + ${count}`,
        lastActivityAt: new Date(),
      })
      .where(eq(agentRuns.id, input.runId))
      .returning({
        nextEventSeq: agentRuns.nextEventSeq,
        startedAt: agentRuns.startedAt,
      });

    if (runRows.length === 0) {
      throw new Error(`agent_runs row missing for runId=${input.runId}`);
    }
    const newSeq: number = runRows[0].nextEventSeq;
    const runStartedAt: Date | null = runRows[0].startedAt;

    // Atomically increment the task counter once for the whole bundle.
    const taskRows = await executor
      .update(tasks)
      .set({ nextEventSeq: sql`${tasks.nextEventSeq} + 1` })
      .where(and(eq(tasks.id, input.taskId), eq(tasks.organisationId, input.organisationId)))
      .returning({ nextEventSeq: tasks.nextEventSeq });

    if (taskRows.length === 0) {
      throw new Error(`tasks row missing for taskId=${input.taskId}`);
    }
    const allocatedTaskSeq: number = taskRows[0].nextEventSeq;

    const eventTimestamp = new Date();
    const startedAtMs = runStartedAt ? runStartedAt.getTime() : eventTimestamp.getTime();

    const values = input.events.map((e, i) => ({
      id: randomUUID(),
      runId: input.runId,
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      // B1: each event gets a unique per-run sequence: (newSeq - count + 1) + i
      sequenceNumber: newSeq - count + 1 + i,
      eventType: e.payload.eventType,
      eventTimestamp,
      // B1: compute real duration from agent_runs.started_at
      durationSinceRunStartMs: computeDurationSinceRunStartMs(startedAtMs, eventTimestamp.getTime()),
      sourceService: e.sourceService,
      payload: e.payload as unknown as Record<string, unknown>,
      // Use the normalised linked entity from the pre-validation pass (not raw
      // caller input) so that the INSERT always receives a validated + normalised
      // value (Issue 1).
      linkedEntityType: normalisedLinkedEntities[i].normalised?.type ?? null,
      linkedEntityId: normalisedLinkedEntities[i].normalised?.id ?? null,
      taskId: input.taskId,
      taskSequence: allocatedTaskSeq,
      eventOrigin: e.origin as EventOrigin,
      eventSubsequence: i,
      eventSchemaVersion: 1,
    }));

    await executor.insert(agentExecutionEvents).values(values);
  };

  if (tx) {
    await run(tx);
  } else {
    await db.transaction(async (innerTx) => {
      await run(innerTx);
    });
  }

  // Socket emission for bundle events is wired in Chunk 9 (WebSocket coordination).
  // Chunk 9 owns the task-room emit path; this function writes to DB only.
}

function collectLinkedEntityIds(
  rows: Array<{ linkedEntityType: string | null; linkedEntityId: string | null }>,
): Array<{ type: string; id: string }> {
  const out: Array<{ type: string; id: string }> = [];
  for (const r of rows) {
    if (r.linkedEntityType && r.linkedEntityId) {
      out.push({ type: r.linkedEntityType, id: r.linkedEntityId });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prompt drilldown
// ---------------------------------------------------------------------------

export async function getPrompt(
  runId: string,
  assemblyNumber: number,
): Promise<AgentRunPrompt | null> {
  const db = getOrgScopedDb('agentExecutionEventService.getPrompt');
  const [row] = await db
    .select()
    .from(agentRunPrompts)
    .where(
      and(
        eq(agentRunPrompts.runId, runId),
        eq(agentRunPrompts.assemblyNumber, assemblyNumber),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    runId: row.runId,
    assemblyNumber: row.assemblyNumber,
    organisationId: row.organisationId,
    subaccountId: row.subaccountId,
    assembledAt: row.assembledAt.toISOString(),
    systemPrompt: row.systemPrompt,
    userPrompt: row.userPrompt,
    toolDefinitions: row.toolDefinitions as unknown[],
    layerAttributions: row.layerAttributions as AgentRunPrompt['layerAttributions'],
    totalTokens: row.totalTokens,
  };
}

// ---------------------------------------------------------------------------
// LLM payload drilldown
// ---------------------------------------------------------------------------

export async function getLlmPayload(
  llmRequestId: string,
): Promise<AgentRunLlmPayload | null> {
  const db = getOrgScopedDb('agentExecutionEventService.getLlmPayload');
  const [row] = await db
    .select()
    .from(agentRunLlmPayloads)
    .where(eq(agentRunLlmPayloads.llmRequestId, llmRequestId))
    .limit(1);
  if (!row) return null;
  return {
    llmRequestId: row.llmRequestId,
    runId: row.runId,
    organisationId: row.organisationId,
    subaccountId: row.subaccountId,
    systemPrompt: row.systemPrompt,
    messages: row.messages as unknown[],
    toolDefinitions: row.toolDefinitions as unknown[],
    // Schema column is nullable as of migration 0241 — failure-path rows
    // record `response: null` when no usable provider output exists. The
    // `AgentRunLlmPayload` type allows null; consumers narrow before access.
    response: row.response as Record<string, unknown> | null,
    redactedFields: row.redactedFields as PayloadRedaction[],
    modifications: row.modifications as PayloadModification[],
    totalSizeBytes: row.totalSizeBytes,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
