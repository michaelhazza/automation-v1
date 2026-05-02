// Live Agent Execution Log — event emission + snapshot reads.
// Spec: tasks/live-agent-execution-log-spec.md §4.1, §4.3, §5.1, §5.9, §6.2.

import { and, asc, eq, gt, gte, inArray, or, sql } from 'drizzle-orm';
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
import { tasks } from '../db/schema/tasks.js';
import { agentRunLlmPayloads } from '../db/schema/agentRunLlmPayloads.js';
import { agentRunPrompts } from '../db/schema/agentRunPrompts.js';
import { agentRuns } from '../db/schema/agentRuns.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { getIO } from '../websocket/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import type { OrgScopedTx } from '../db/index.js';
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
  // Workflows V1 — task-scoped event fields
  taskId?: string | null;
  eventOrigin?: EventOrigin;
  /** Defaults to 0. */
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
 * When `input.taskId` is set, additionally allocates a task-scoped sequence
 * number from `tasks.next_event_seq` inside a single transaction so both
 * the sequence allocation and the event INSERT are atomic.
 */
async function persistEvent(
  input: AppendEventInput,
  linkedEntity: LinkedEntityRef,
  critical: boolean,
  maxEvents: number,
): Promise<PersistedEvent | null> {
  const db = getOrgScopedDb('agentExecutionEventService.appendEvent');

  // ── Allocate per-run sequence number ─────────────────────────────────
  //
  // Critical events bypass the cap so lifecycle bookends always emit.
  // Non-critical events use the `< $cap` guard — empty RETURNING means we
  // short-circuit.
  let nextSeq: number | null;
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
  const durationSinceRunStartMs = computeDurationSinceRunStartMs(
    startedAtMs,
    eventTimestamp.getTime(),
  );

  const eventSubsequence = input.eventSubsequence ?? 0;

  // ── Insert the event row ──────────────────────────────────────────────
  //
  // When taskId is provided, we must allocate the task-scoped sequence and
  // insert the event in a single transaction (atomicity invariant).
  // When taskId is absent, the existing non-transactional path is preserved.

  let rowId: string;
  let rowTimestamp: Date;
  let allocatedTaskSeq: number | null = null;

  if (input.taskId) {
    const taskId = input.taskId;
    const result = await db.transaction(async (tx) => {
      // Allocate task sequence
      const taskRows = await tx
        .update(tasks)
        .set({ nextEventSeq: sql`${tasks.nextEventSeq} + 1` })
        .where(eq(tasks.id, taskId))
        .returning({ nextEventSeq: tasks.nextEventSeq });
      if (taskRows.length === 0) {
        throw new Error(`tasks row missing for taskId=${taskId}`);
      }
      const taskSeq = taskRows[0].nextEventSeq;

      const [inserted] = await tx
        .insert(agentExecutionEvents)
        .values({
          id: randomUUID(),
          runId: input.runId,
          organisationId: input.organisationId,
          subaccountId: input.subaccountId,
          sequenceNumber: nextSeq!,
          eventType: input.payload.eventType,
          eventTimestamp,
          durationSinceRunStartMs,
          sourceService: input.sourceService,
          payload: input.payload as unknown as Record<string, unknown>,
          linkedEntityType: linkedEntity?.type ?? null,
          linkedEntityId: linkedEntity?.id ?? null,
          taskId,
          taskSequence: taskSeq,
          eventOrigin: input.eventOrigin ?? null,
          eventSubsequence,
          eventSchemaVersion: 1,
        })
        .returning({
          id: agentExecutionEvents.id,
          eventTimestamp: agentExecutionEvents.eventTimestamp,
        });

      return { id: inserted.id, eventTimestamp: inserted.eventTimestamp, taskSeq };
    });

    rowId = result.id;
    rowTimestamp = result.eventTimestamp ?? eventTimestamp;
    allocatedTaskSeq = result.taskSeq;
  } else {
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
        eventSubsequence,
        eventSchemaVersion: 1,
      })
      .returning({
        id: agentExecutionEvents.id,
        eventTimestamp: agentExecutionEvents.eventTimestamp,
      });

    rowId = row.id;
    rowTimestamp = row.eventTimestamp ?? eventTimestamp;
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
    eventTimestamp: rowTimestamp.toISOString(),
    durationSinceRunStartMs,
    sourceService: input.sourceService,
    payload: input.payload,
    linkedEntity: linkedEntity
      ? { type: linkedEntity.type, id: linkedEntity.id, label: '' }
      : null,
    permissionMask: EMPTY_MASK,
    taskId: input.taskId ?? null,
    taskSequence: allocatedTaskSeq,
    eventOrigin: input.eventOrigin ?? null,
    eventSubsequence,
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
    eventSubsequence: null,
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

  const { event } = persisted;
  const taskContext =
    event.taskId != null && event.taskSequence != null && event.eventSubsequence != null
      ? { taskId: event.taskId, taskSequence: event.taskSequence, eventSubsequence: event.eventSubsequence }
      : undefined;

  const envelope: AgentExecutionEventEnvelope = {
    eventId: buildEventId(
      event.runId,
      event.sequenceNumber,
      event.eventType,
      taskContext,
    ),
    type: 'agent-run:execution-event',
    entityId: event.runId,
    timestamp: event.eventTimestamp,
    payload: event,
  };

  // No per-socket mask computation in P1 — emit the empty mask on the
  // wire and let the client re-query the snapshot endpoint for a
  // permission-bearing view. Socket-user tracking is wired on the room-
  // join handler side (see server/websocket/rooms.ts) — ensuring the
  // socket is authorised to be in the room is the bar; mask rendering
  // in the live stream can be a follow-up without changing the shape of
  // the socket envelope.
  io.to(`agent-run:${event.runId}`).emit(envelope.type, envelope);
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
      eventOrigin: (row.eventOrigin as EventOrigin | null) ?? null,
      eventSubsequence: row.eventSubsequence ?? null,
    };
  });

  const highestSequenceNumber =
    events.length > 0 ? events[events.length - 1].sequenceNumber : fromSeq - 1;

  return { events, hasMore, highestSequenceNumber };
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
// streamEventsByTask — per-task replay
// ---------------------------------------------------------------------------

export interface StreamEventsByTaskOptions {
  /** Start after this task_sequence value. Defaults to 0 (include all). */
  fromSeq?: number;
  /** Start after this event_subsequence within fromSeq. Defaults to -1 (include subseq 0). */
  fromSubseq?: number;
  limit?: number;
  forUser: PermissionMaskUserContext;
}

/**
 * Paginated snapshot of events scoped to a single task.
 *
 * Sort: `(task_sequence ASC, event_subsequence ASC)` — never by sequence_number.
 * Cursor: composite `(fromSeq, fromSubseq)` so a caller can resume mid-bundle.
 */
export async function streamEventsByTask(
  taskId: string,
  opts: StreamEventsByTaskOptions,
): Promise<AgentExecutionEventPage> {
  const db = getOrgScopedDb('agentExecutionEventService.streamEventsByTask');
  const fromSeq = opts.fromSeq ?? 0;
  const fromSubseq = opts.fromSubseq ?? -1;
  const limit = Math.min(Math.max(1, opts.limit ?? 1000), 1000);

  // WHERE task_id = $1
  //   AND (task_sequence > fromSeq
  //        OR (task_sequence = fromSeq AND event_subsequence > fromSubseq))
  const rows = await db
    .select()
    .from(agentExecutionEvents)
    .where(
      and(
        eq(agentExecutionEvents.taskId, taskId),
        or(
          gt(agentExecutionEvents.taskSequence, fromSeq),
          and(
            eq(agentExecutionEvents.taskSequence, fromSeq),
            gt(agentExecutionEvents.eventSubsequence, fromSubseq),
          ),
        ),
      ),
    )
    .orderBy(
      asc(agentExecutionEvents.taskSequence),
      asc(agentExecutionEvents.eventSubsequence),
    )
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const labelMap = await resolveLinkedEntityLabels(collectLinkedEntityIds(page));

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
      eventOrigin: (row.eventOrigin as EventOrigin | null) ?? null,
      eventSubsequence: row.eventSubsequence ?? null,
    };
  });

  // Return the composite task cursor (taskSequence + eventSubsequence) so
  // callers can resume at the exact mid-bundle position after a page cut.
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const highestSequenceNumber = lastEvent?.taskSequence ?? fromSeq;
  const highestSubsequence = lastEvent?.eventSubsequence ?? fromSubseq;

  return { events, hasMore, highestSequenceNumber, highestSubsequence };
}

// ---------------------------------------------------------------------------
// appendEventBundle — multi-event single-sequence write
// ---------------------------------------------------------------------------

export interface EventBundleItem {
  origin: EventOrigin;
  payload: AgentExecutionEventPayload;
  sourceService: AgentExecutionSourceService;
  linkedEntity?: LinkedEntityRef;
}

/**
 * Write multiple events sharing the same logical task_sequence in a single
 * operation. Each event gets `event_subsequence = its index` in the array.
 *
 * MUST be called within an existing DB transaction. The caller provides `tx`
 * and this function never opens its own transaction (transaction-ownership-
 * at-engine-layer invariant). The task_sequence is allocated by incrementing
 * `tasks.next_event_seq` within the provided transaction.
 *
 * No socket emit from the bundle helper — caller emits if needed (Chunk 9).
 */
export async function appendEventBundle(
  taskId: string,
  runId: string,
  organisationId: string,
  subaccountId: string | null,
  events: EventBundleItem[],
  tx: OrgScopedTx,
): Promise<void> {
  if (events.length === 0) return;

  // Allocate one task-sequence for the entire bundle (intra-bundle order uses event_subsequence).
  const taskRows = await tx
    .update(tasks)
    .set({ nextEventSeq: sql`${tasks.nextEventSeq} + 1` })
    .where(eq(tasks.id, taskId))
    .returning({ nextEventSeq: tasks.nextEventSeq });

  if (taskRows.length === 0) {
    throw new Error(`tasks row missing for taskId=${taskId}`);
  }
  const taskSeq = taskRows[0].nextEventSeq;

  // Allocate N per-run sequence numbers in one UPDATE so the unique
  // (run_id, sequence_number) constraint is never violated across bundle calls.
  const runRows = await tx
    .update(agentRuns)
    .set({ nextEventSeq: sql`${agentRuns.nextEventSeq} + ${events.length}` })
    .where(eq(agentRuns.id, runId))
    .returning({ nextEventSeq: agentRuns.nextEventSeq });

  if (runRows.length === 0) {
    throw new Error(`agent_runs row missing for runId=${runId}`);
  }
  const lastRunSeq = runRows[0].nextEventSeq;
  const firstRunSeq = lastRunSeq - events.length + 1;

  const eventTimestamp = new Date();

  const rows = events.map((item, i) => ({
    id: randomUUID(),
    runId,
    organisationId,
    subaccountId,
    sequenceNumber: firstRunSeq + i,
    eventType: item.payload.eventType,
    eventTimestamp,
    durationSinceRunStartMs: 0,
    sourceService: item.sourceService,
    payload: item.payload as unknown as Record<string, unknown>,
    linkedEntityType: item.linkedEntity?.type ?? null,
    linkedEntityId: item.linkedEntity?.id ?? null,
    taskId,
    taskSequence: taskSeq,
    eventOrigin: item.origin as string,
    eventSubsequence: i,
    eventSchemaVersion: 1,
  }));

  await tx.insert(agentExecutionEvents).values(rows);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
