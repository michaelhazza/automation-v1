/**
 * inactiveWorkflows.ts — Optimiser telemetry query (Chunk 2)
 *
 * Finds sub-account agent links that have schedule_enabled=true AND schedule_cron IS NOT NULL
 * (cron-scheduled only) but whose most recent agent_run.started_at is older than 1.5× the
 * expected cadence. Uses computeNextHeartbeatAt from scheduleCalendarServicePure to derive
 * the expected next-run time, then compares to agent_runs.started_at.
 *
 * Query cost guardrail: agent_runs lookup is bounded to last 7 days.
 * Called by the evaluator in Chunk 3; this module returns raw data only.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../../../lib/adminDbConnection.js';
import { logger } from '../../../lib/logger.js';
import { computeNextHeartbeatAt } from '../../scheduleCalendarServicePure.js';

export interface InactiveWorkflowRow {
  subaccount_agent_id: string;
  agent_id: string;
  agent_name: string;
  expected_cadence: string;  // human-readable description
  last_run_at: string | null; // ISO-8601 or null
}

const SOURCE = 'optimiser.inactiveWorkflows';

/** Converts a cron expression to a human-readable cadence description. */
function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length === 5) {
    const [min, hour, dom, month, dow] = parts;
    if (dom === '*' && month === '*' && dow === '*') {
      if (min === '0' && hour !== '*') {
        return `daily at ${hour}:00 UTC`;
      }
      if (hour === '*') {
        return `every hour at minute ${min}`;
      }
      return `daily (${cron})`;
    }
    if (dow !== '*') {
      return `weekly (${cron})`;
    }
  }
  return cron;
}

/** Returns true if a sub-account agent is "inactive" — last run is missing or overdue. */
function isInactive(params: {
  lastRunAt: Date | null;
  heartbeatIntervalHours: number;
  heartbeatOffsetHours: number;
  heartbeatOffsetMinutes: number;
  nowMs: number;
}): boolean {
  const { lastRunAt, heartbeatIntervalHours, heartbeatOffsetHours, heartbeatOffsetMinutes, nowMs } = params;

  if (!lastRunAt) return true;

  // Expected next run after the last run
  const expectedNextMs = computeNextHeartbeatAt(
    lastRunAt.getTime(),
    heartbeatIntervalHours,
    heartbeatOffsetHours,
    heartbeatOffsetMinutes,
  );

  // Add a 50% grace buffer to avoid false positives on borderline schedules (spec: 1.5× cadence)
  const gracePeriodMs = heartbeatIntervalHours * 60 * 60 * 1000 * 0.5;
  return nowMs > expectedNextMs + gracePeriodMs;
}

export async function queryInactiveWorkflows(input: {
  subaccountId: string;
  organisationId: string;
}): Promise<InactiveWorkflowRow[]> {
  const { subaccountId, organisationId } = input;

  try {
    return await withAdminConnection(
      { source: SOURCE, reason: 'optimiser scan: inactive workflows', skipAudit: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        const result = await tx.execute(sql`
          SELECT
            sa.id                     AS subaccount_agent_id,
            sa.agent_id::text         AS agent_id,
            a.name                    AS agent_name,
            sa.schedule_cron,
            sa.heartbeat_interval_hours,
            sa.heartbeat_offset_hours,
            sa.heartbeat_offset_minutes,
            MAX(ar.started_at)        AS last_run_at
          FROM subaccount_agents sa
          JOIN agents a ON a.id = sa.agent_id
          LEFT JOIN agent_runs ar
            ON ar.subaccount_agent_id = sa.id
            AND ar.started_at >= now() - INTERVAL '7 days'
          WHERE sa.subaccount_id = ${subaccountId}
            AND sa.organisation_id = ${organisationId}
            AND sa.is_active = true
            AND sa.schedule_enabled = true
            AND sa.schedule_cron IS NOT NULL
          GROUP BY sa.id, sa.agent_id, a.name, sa.schedule_cron,
                   sa.heartbeat_interval_hours, sa.heartbeat_offset_hours,
                   sa.heartbeat_offset_minutes
        `);

        const nowMs = Date.now();
        const rows = result as unknown as Array<{
          subaccount_agent_id: string;
          agent_id: string;
          agent_name: string;
          schedule_cron: string | null;
          heartbeat_interval_hours: number | null;
          heartbeat_offset_hours: number | null;
          heartbeat_offset_minutes: number | null;
          last_run_at: string | null;
        }>;

        return rows
          .filter((row) => {
            const lastRunAt = row.last_run_at ? new Date(row.last_run_at) : null;
            const intervalHours = row.heartbeat_interval_hours ?? 24;
            const offsetHours = row.heartbeat_offset_hours ?? 0;
            const offsetMins = row.heartbeat_offset_minutes ?? 0;

            return isInactive({
              lastRunAt,
              heartbeatIntervalHours: intervalHours,
              heartbeatOffsetHours: offsetHours,
              heartbeatOffsetMinutes: offsetMins,
              nowMs,
            });
          })
          .map((row) => ({
            subaccount_agent_id: String(row.subaccount_agent_id),
            agent_id: String(row.agent_id),
            agent_name: String(row.agent_name || ''),
            expected_cadence: row.schedule_cron
              ? describeCron(row.schedule_cron)
              : `every ${row.heartbeat_interval_hours ?? 24}h`,
            last_run_at: row.last_run_at ?? null,
          }));
      },
    );
  } catch (err) {
    logger.error(`${SOURCE}.failed`, {
      subaccountId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw Object.assign(new Error('optimiser query failed'), {
      statusCode: 500,
      errorCode: 'inactive_workflows_failed',
    });
  }
}
