import { eq, and, between, lt, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import { agentWorkingTimeEventLedger, agentWorkingTimeRollups, agentRuns, agentExecutionEvents } from '../db/schema/index.js';
import { splitIntervalAcrossBuckets } from './agentWorkingTimeServicePure.js';
import { fanOut } from './agentPresenceStreamPublisher.js';
import { randomUUID } from 'node:crypto';
import type { AgentExecutionEvent } from '../../shared/types/agentExecutionLog.js';
import type { AgentWorkingTimeRollup } from '../db/schema/agentWorkingTimeRollups.js';
import type { PrincipalContext } from './principal/types.js';

function msToUtcDateString(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayUtcDateString(): string {
  return msToUtcDateString(Date.now());
}

async function emitWorkingTimeBucketUpdated(
  agentId: string,
  organisationId: string,
  bucketDate: string,
  eventTimestamp: string,
): Promise<void> {
  // Only emit SSE for the active bucket (spec §13.7)
  if (bucketDate !== todayUtcDateString()) return;

  const db = getOrgScopedDb('agentWorkingTimeService.emitWorkingTimeBucketUpdated');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const rows = await db
    .select({
      workingTimeSeconds: agentWorkingTimeRollups.workingTimeSeconds,
      totalRunCount: agentWorkingTimeRollups.totalRunCount,
      successfulRuns: agentWorkingTimeRollups.successfulRuns,
      failedRuns: agentWorkingTimeRollups.failedRuns,
      partialRuns: agentWorkingTimeRollups.partialRuns,
    })
    .from(agentWorkingTimeRollups)
    .where(
      and(
        eq(agentWorkingTimeRollups.organisationId, organisationId),
        eq(agentWorkingTimeRollups.agentId, agentId),
        eq(agentWorkingTimeRollups.bucketDate, bucketDate),
      ),
    )
    .limit(1);

  if (rows.length === 0) return;
  const row = rows[0];

  fanOut({
    agentId,
    organisationId,
    eventTimestamp,
    serverNow: new Date().toISOString(),
    eventId: randomUUID(),
    eventType: 'working_time_bucket_updated',
    data: {
      bucketDate,
      workingTimeSeconds: row.workingTimeSeconds,
      totalRunCount: row.totalRunCount,
      successfulRuns: row.successfulRuns,
      failedRuns: row.failedRuns,
      partialRuns: row.partialRuns,
    },
  });
}

// ---------------------------------------------------------------------------
// applyEvent
// ---------------------------------------------------------------------------

export async function applyEvent(
  event: AgentExecutionEvent,
  ctx: PrincipalContext,
): Promise<void> {
  const db = getOrgScopedDb('agentWorkingTimeService.applyEvent');
  const organisationId = ctx.organisationId;

  // Resolve agentId from the run
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const runRows = await db
    .select({ agentId: agentRuns.agentId })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.id, event.runId),
        eq(agentRuns.organisationId, organisationId),
      ),
    )
    .limit(1);

  if (runRows.length === 0) return;
  const agentId = runRows[0].agentId;

  // 1. Ledger idempotency — bail out early if already processed
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const ledgerResult = await db
    .insert(agentWorkingTimeEventLedger)
    .values({
      eventId: event.id,
      organisationId,
      agentId,
      appliedAt: new Date(),
    })
    .onConflictDoNothing({ target: agentWorkingTimeEventLedger.eventId })
    .returning({ eventId: agentWorkingTimeEventLedger.eventId });

  if (ledgerResult.length === 0) {
    // Already processed — idempotent no-op
    return;
  }

  const eventTypeStr = event.eventType as string;

  // 2. step_started events are tracked only via the ledger — working time is
  //    computed at step_completed time by querying the persisted start event.
  if (eventTypeStr === 'step_started') {
    return;
  }

  // 3. step_completed — pair to the matching step_started by stable step
  //    identity (spec §7.5). Strict fail-closed: never cross-fall-through
  //    between identity paths, because identity asymmetry between an end
  //    and a start indicates a producer bug, not a legacy event.
  //
  //    Pairing paths in priority order:
  //      a) `payload.stepId` present → match start by `payload->>'stepId'`.
  //         If no match, drop + warn `step_identity_missing`.
  //      b) `(taskId, taskSequence)` both present (Workflows V1) → match
  //         start by both. If no match, drop + warn.
  //      c) Neither present (true legacy event) → fall back to "latest
  //         prior step_started in same run" ONLY IF no identified open
  //         start exists in this run. Otherwise the unidentified end could
  //         ambiguously match an identified open — drop + warn.
  //
  //    Path (a/b) failure does NOT fall through to (c). Cross-pairing under
  //    identity asymmetry would silently mis-attribute time.
  if (eventTypeStr === 'step_completed') {
    const completedPayload = (event.payload ?? {}) as { stepId?: string | null };
    const stepId = typeof completedPayload.stepId === 'string' && completedPayload.stepId.length > 0
      ? completedPayload.stepId
      : null;
    const completedTaskId = (event as { taskId?: string | null }).taskId ?? null;
    const completedTaskSequence = (event as { taskSequence?: number | null }).taskSequence ?? null;
    const hasTaskKey = completedTaskId !== null && completedTaskSequence !== null;

    let startRows: Array<{ eventTimestamp: Date | string }>;

    if (stepId) {
      // Path (a): pair by explicit stepId.
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      startRows = await db
        .select({ eventTimestamp: agentExecutionEvents.eventTimestamp })
        .from(agentExecutionEvents)
        .where(
          and(
            eq(agentExecutionEvents.runId, event.runId),
            eq(agentExecutionEvents.organisationId, organisationId),
            eq(agentExecutionEvents.eventType, 'step_started'),
            lt(agentExecutionEvents.sequenceNumber, event.sequenceNumber),
            sql`${agentExecutionEvents.payload}->>'stepId' = ${stepId}`,
          ),
        )
        .orderBy(desc(agentExecutionEvents.sequenceNumber))
        .limit(1);

      if (startRows.length === 0) {
        logger.warn('working_time.step_identity_missing', {
          runId: event.runId,
          eventId: event.id,
          reason: 'stepId on completed has no matching start',
          stepId,
        });
        return;
      }
    } else if (hasTaskKey) {
      // Path (b): pair by workflow `(taskId, taskSequence)`.
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      startRows = await db
        .select({ eventTimestamp: agentExecutionEvents.eventTimestamp })
        .from(agentExecutionEvents)
        .where(
          and(
            eq(agentExecutionEvents.runId, event.runId),
            eq(agentExecutionEvents.organisationId, organisationId),
            eq(agentExecutionEvents.eventType, 'step_started'),
            lt(agentExecutionEvents.sequenceNumber, event.sequenceNumber),
            eq(agentExecutionEvents.taskId, completedTaskId!),
            eq(agentExecutionEvents.taskSequence, completedTaskSequence!),
          ),
        )
        .orderBy(desc(agentExecutionEvents.sequenceNumber))
        .limit(1);

      if (startRows.length === 0) {
        logger.warn('working_time.step_identity_missing', {
          runId: event.runId,
          eventId: event.id,
          reason: 'task key on completed has no matching start',
          taskId: completedTaskId,
          taskSequence: completedTaskSequence,
        });
        return;
      }
    } else {
      // Path (c): legacy event with no identity. Only safe to fall back
      // when no identified concurrent step is open for this run. The check
      // counts identified starts vs identified completions in this run; if
      // starts > completions, an identified open exists and the
      // unidentified end cannot be safely paired.
      const openIdentified = await db.execute<{ open_count: number }>(sql`
        SELECT GREATEST(0,
          (SELECT COUNT(*)::int FROM agent_execution_events s
           WHERE s.run_id = ${event.runId}::uuid
             AND s.organisation_id = ${organisationId}::uuid
             AND s.event_type = 'step_started'
             AND s.sequence_number < ${event.sequenceNumber}
             AND (s.payload->>'stepId' IS NOT NULL
                  OR (s.task_id IS NOT NULL AND s.task_sequence IS NOT NULL)))
          -
          (SELECT COUNT(*)::int FROM agent_execution_events e
           WHERE e.run_id = ${event.runId}::uuid
             AND e.organisation_id = ${organisationId}::uuid
             AND e.event_type = 'step_completed'
             AND e.sequence_number < ${event.sequenceNumber}
             AND (e.payload->>'stepId' IS NOT NULL
                  OR (e.task_id IS NOT NULL AND e.task_sequence IS NOT NULL)))
        ) AS open_count
      `);

      const openCountRows = openIdentified as unknown as Array<{ open_count: number }>;
      const openCount = openCountRows[0]?.open_count ?? 0;

      if (openCount > 0) {
        logger.warn('working_time.step_identity_missing', {
          runId: event.runId,
          eventId: event.id,
          reason: 'unidentified completed while identified step is open',
          openIdentifiedCount: openCount,
        });
        return;
      }

      logger.warn('working_time.step_completed_without_step_id', {
        runId: event.runId,
        eventId: event.id,
        hasStepId: false,
        hasTaskKey: false,
      });
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      startRows = await db
        .select({ eventTimestamp: agentExecutionEvents.eventTimestamp })
        .from(agentExecutionEvents)
        .where(
          and(
            eq(agentExecutionEvents.runId, event.runId),
            eq(agentExecutionEvents.organisationId, organisationId),
            eq(agentExecutionEvents.eventType, 'step_started'),
            lt(agentExecutionEvents.sequenceNumber, event.sequenceNumber),
          ),
        )
        .orderBy(desc(agentExecutionEvents.sequenceNumber))
        .limit(1);
    }

    if (startRows.length === 0) {
      logger.warn('working_time.step_completed_without_start', { runId: event.runId, eventId: event.id });
      return;
    }

    const startMs = new Date(startRows[0].eventTimestamp as Date | string).getTime();
    const endMs = new Date(event.eventTimestamp).getTime();
    if (endMs <= startMs) return;

    const contributions = splitIntervalAcrossBuckets(startMs, endMs);

    const eventTs = typeof event.eventTimestamp === 'string'
      ? event.eventTimestamp
      : new Date(event.eventTimestamp).toISOString();

    for (const { bucketDate, contributionMs } of contributions) {
      const contributionSeconds = Math.floor(contributionMs / 1000);
      if (contributionSeconds <= 0) continue;

      await db.execute(sql`
        INSERT INTO agent_working_time_rollups (
          organisation_id,
          agent_id,
          bucket_date,
          working_time_seconds,
          updated_at
        ) VALUES (
          ${organisationId}::uuid,
          ${agentId}::uuid,
          ${bucketDate}::date,
          ${contributionSeconds},
          NOW()
        )
        ON CONFLICT (organisation_id, agent_id, bucket_date) DO UPDATE SET
          working_time_seconds = agent_working_time_rollups.working_time_seconds + EXCLUDED.working_time_seconds,
          updated_at           = EXCLUDED.updated_at
      `);

      void emitWorkingTimeBucketUpdated(agentId, organisationId, bucketDate, eventTs).catch(() => {
        // fire-and-forget; SSE emission failure does not affect working-time persistence
      });
    }
    return;
  }

  // 4. run.completed — increment run-count columns in the event's daily bucket
  if (eventTypeStr === 'run.completed') {
    const payload = event.payload as { finalStatus: string };
    const isSuccess = payload.finalStatus === 'completed';
    const bucketDate = msToUtcDateString(new Date(event.eventTimestamp).getTime());
    const eventTs = typeof event.eventTimestamp === 'string'
      ? event.eventTimestamp
      : new Date(event.eventTimestamp).toISOString();

    await db.execute(sql`
      INSERT INTO agent_working_time_rollups (
        organisation_id,
        agent_id,
        bucket_date,
        working_time_seconds,
        successful_runs,
        failed_runs,
        partial_runs,
        total_run_count,
        updated_at
      ) VALUES (
        ${organisationId}::uuid,
        ${agentId}::uuid,
        ${bucketDate}::date,
        0,
        ${isSuccess ? 1 : 0},
        ${isSuccess ? 0 : 1},
        0,
        1,
        NOW()
      )
      ON CONFLICT (organisation_id, agent_id, bucket_date) DO UPDATE SET
        successful_runs = agent_working_time_rollups.successful_runs + EXCLUDED.successful_runs,
        failed_runs     = agent_working_time_rollups.failed_runs + EXCLUDED.failed_runs,
        total_run_count = agent_working_time_rollups.total_run_count + EXCLUDED.total_run_count,
        updated_at      = EXCLUDED.updated_at
    `);

    void emitWorkingTimeBucketUpdated(agentId, organisationId, bucketDate, eventTs).catch(() => {
      // fire-and-forget; SSE emission failure does not affect working-time persistence
    });
    return;
  }
}

// ---------------------------------------------------------------------------
// getRollupsForRange
// ---------------------------------------------------------------------------

export async function getRollupsForRange(
  agentId: string,
  startDate: string,
  endDate: string,
  ctx: PrincipalContext,
): Promise<AgentWorkingTimeRollup[]> {
  const db = getOrgScopedDb('agentWorkingTimeService.getRollupsForRange');
  const organisationId = ctx.organisationId;

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const rows = await db
    .select()
    .from(agentWorkingTimeRollups)
    .where(
      and(
        eq(agentWorkingTimeRollups.organisationId, organisationId),
        eq(agentWorkingTimeRollups.agentId, agentId),
        between(agentWorkingTimeRollups.bucketDate, startDate, endDate),
      ),
    )
    .orderBy(agentWorkingTimeRollups.bucketDate);

  return rows;
}
