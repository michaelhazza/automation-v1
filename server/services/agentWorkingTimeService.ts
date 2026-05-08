import { eq, and, between } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import { agentWorkingTimeEventLedger, agentWorkingTimeRollups, agentRuns } from '../db/schema/index.js';
import { splitIntervalAcrossBuckets } from './agentWorkingTimeServicePure.js';
import type { AgentExecutionEvent } from '../../shared/types/agentExecutionLog.js';
import type { AgentWorkingTimeRollup } from '../db/schema/agentWorkingTimeRollups.js';
import type { PrincipalContext } from './principal/types.js';

// ---------------------------------------------------------------------------
// In-process step-start time tracking for step_started/step_completed pairing.
// Key: runId — stores the start timestamp (ms) of the current open step.
// ---------------------------------------------------------------------------
const stepStartMap = new Map<string, number>();

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

  // 2. Only step_started / step_completed events produce working time
  const eventTypeStr = event.eventType as string;
  if (eventTypeStr === 'step_started') {
    stepStartMap.set(event.runId, new Date(event.eventTimestamp).getTime());
    return;
  }

  if (eventTypeStr !== 'step_completed') {
    return;
  }

  // step_completed — pop the start time
  const startMs = stepStartMap.get(event.runId);
  if (startMs === undefined) {
    // No matching step_started in memory — service restart or out-of-order delivery.
    // Working time for this step is unrecoverable; log WARN so the gap is observable.
    logger.warn('working_time.step_completed_without_start', { runId: event.runId, eventId: event.id });
    return;
  }
  stepStartMap.delete(event.runId);

  const endMs = new Date(event.eventTimestamp).getTime();
  if (endMs <= startMs) return;

  // 3. Bucket split
  const contributions = splitIntervalAcrossBuckets(startMs, endMs);

  // 4. Bucket upserts — all in the same transaction (the outer org-scoped tx)
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
