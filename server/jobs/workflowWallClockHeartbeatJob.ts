/**
 * workflowWallClockHeartbeatJob.ts — 60-second wall-clock cap heartbeat.
 *
 * Spec §5.7 (wall-clock runaway protection): a 60-second pg-boss heartbeat
 * job pauses long-running workflow runs whose wall-clock cap has been exceeded,
 * without waiting for the next between-step tick. Note: pg-boss cron has a
 * 1-minute minimum resolution; spec target was 30s -- see `tasks/todo.md`
 * § Deferred from Chunk 7.
 *
 * The check uses DB-side time only (EXTRACT(EPOCH FROM (now() - started_at)))
 * to avoid clock skew from the application process.
 *
 * Execution contract:
 *   - Cross-org SELECT uses withAdminConnection + SET LOCAL ROLE admin_role so
 *     RLS does not filter out rows for tenants other than the current session.
 *   - Per-row pause runs in a fresh db.transaction with app.organisation_id set
 *     so the UPDATE is evaluated under the correct RLS policy for that tenant.
 *
 * Registered via WorkflowEngineService.registerWorkers().
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';
import { WorkflowRunPauseStopService } from '../services/workflowRunPauseStopService.js';

export const WALL_CLOCK_HEARTBEAT_QUEUE = 'workflow-wall-clock-heartbeat';

export async function runWallClockHeartbeat(): Promise<void> {
  // Phase 1 — cross-org SELECT under admin_role to bypass RLS.
  let matches: Array<{ id: string; organisation_id: string }>;
  try {
    matches = await withAdminConnection(
      {
        source: 'jobs.workflowWallClockHeartbeat',
        reason: 'Cross-org sweep for runs that have exceeded their wall-clock cap',
        skipAudit: true,
      },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        const rows = (await tx.execute(sql`
          SELECT id, organisation_id
          FROM workflow_runs
          WHERE status = 'running'
            AND effective_wall_clock_cap_seconds IS NOT NULL
            AND EXTRACT(EPOCH FROM (now() - started_at))::integer >= effective_wall_clock_cap_seconds
        `)) as unknown as { rows?: Array<{ id: string; organisation_id: string }> };
        return rows.rows ?? [];
      },
    );
  } catch (err) {
    logger.error('workflow_wall_clock_heartbeat_select_failed', {
      event: 'wall_clock_heartbeat.select_failed',
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (matches.length === 0) return;

  logger.info('workflow_wall_clock_heartbeat_run', {
    event: 'wall_clock_heartbeat.run',
    count: matches.length,
  });

  // Phase 2 — per-row pause, each in a fresh tenant-scoped transaction so RLS
  // policies are engaged correctly for the UPDATE.
  for (const row of matches) {
    try {
      await db.transaction(async (orgTx) => {
        await orgTx.execute(
          sql`SELECT set_config('app.organisation_id', ${row.organisation_id}, true)`
        );
        await withOrgTx(
          { tx: orgTx, organisationId: row.organisation_id, source: 'jobs.workflowWallClockHeartbeat:per-row' },
          async () => {
            await WorkflowRunPauseStopService.pauseRunBetweenSteps(
              row.id,
              row.organisation_id,
              'wall_clock',
              orgTx
            );
          }
        );
      });
    } catch (err) {
      logger.error('workflow_wall_clock_heartbeat_pause_failed', {
        event: 'wall_clock_heartbeat.pause_failed',
        runId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
