/**
 * maintenance:working-time-rollup-compact
 * Collapses per-day agent_working_time_rollups buckets older than 1 year
 * to monthly resolution.
 * Scheduled at 6am UTC on the 1st of each month in queueService.ts.
 *
 * Algorithm:
 *   - Per org: find per-agent monthly aggregates for daily rows older than 1 year.
 *   - Delete daily rows, insert monthly summary rows with bucket_date = 'YYYY-MM-01'.
 *   - ON CONFLICT adds to the existing monthly row if one already exists.
 *
 * Idempotency: state-based (daily rows absent or monthly row already present;
 *   ON CONFLICT DO UPDATE is additive and safe on re-run).
 * Retry classification: safe (pg-boss retry is acceptable).
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';

const SOURCE = 'working-time-rollup-compact' as const;

export interface WorkingTimeRollupCompactResult {
  status: 'success' | 'partial' | 'failed';
  orgsAttempted: number;
  orgsSucceeded: number;
  orgsFailed: number;
  durationMs: number;
}

export async function runWorkingTimeRollupCompact(): Promise<WorkingTimeRollupCompactResult> {
  const jobRunId = crypto.randomUUID();
  const startedAt = Date.now();

  logger.info(`${SOURCE}.started`, { jobRunId, scheduledAt: new Date().toISOString() });

  // Phase 1 — fetch org list under one short-lived admin tx.
  let orgs: Array<{ id: string }>;
  try {
    orgs = await withAdminConnection(
      { source: SOURCE, reason: 'Monthly working-time rollup compaction: enumerate orgs', skipAudit: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        return (await tx.execute(
          sql`SELECT id FROM organisations`,
        )) as unknown as Array<{ id: string }>;
      },
    );
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result: WorkingTimeRollupCompactResult = {
      status: 'failed',
      orgsAttempted: 0,
      orgsSucceeded: 0,
      orgsFailed: 0,
      durationMs,
    };
    logger.error(`${SOURCE}.completed`, {
      jobRunId,
      ...result,
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  let orgsSucceeded = 0;
  let orgsFailed = 0;

  // Phase 2 — per-org compaction in a fresh tenant-scoped tx.
  for (const org of orgs) {
    logger.info(`${SOURCE}.org_started`, { jobRunId, orgId: org.id });
    const orgStart = Date.now();
    try {
      await db.transaction(async (orgTx) => {
        await orgTx.execute(sql`SELECT set_config('app.organisation_id', ${org.id}, true)`);
        return withOrgTx(
          { tx: orgTx, organisationId: org.id, source: `${SOURCE}:per-org` },
          async () => {
            // Collapse daily rows older than 1 year into monthly summary rows.
            // Uses a CTE to aggregate first, then delete daily rows, then insert monthly rows.
            await orgTx.execute(
              sql`WITH monthly_agg AS (
                    SELECT organisation_id, agent_id,
                      substring(bucket_date::text, 1, 7) AS month,
                      SUM(working_time_seconds) AS wts,
                      SUM(total_run_count) AS trc,
                      SUM(successful_runs) AS sr,
                      SUM(failed_runs) AS fr,
                      SUM(partial_runs) AS pr
                    FROM agent_working_time_rollups
                    WHERE organisation_id = ${org.id}::uuid
                      AND bucket_date < (CURRENT_DATE - INTERVAL '1 year')::date
                    GROUP BY organisation_id, agent_id, substring(bucket_date::text, 1, 7)
                  ),
                  deleted AS (
                    DELETE FROM agent_working_time_rollups
                    WHERE organisation_id = ${org.id}::uuid
                      AND bucket_date < (CURRENT_DATE - INTERVAL '1 year')::date
                    RETURNING bucket_date
                  )
                  INSERT INTO agent_working_time_rollups (organisation_id, agent_id, bucket_date, working_time_seconds, total_run_count, successful_runs, failed_runs, partial_runs)
                  SELECT organisation_id, agent_id, (month || '-01')::date, wts, trc, sr, fr, pr
                  FROM monthly_agg
                  ON CONFLICT (organisation_id, agent_id, bucket_date) DO UPDATE
                    SET working_time_seconds = agent_working_time_rollups.working_time_seconds + EXCLUDED.working_time_seconds,
                        total_run_count = agent_working_time_rollups.total_run_count + EXCLUDED.total_run_count,
                        successful_runs = agent_working_time_rollups.successful_runs + EXCLUDED.successful_runs,
                        failed_runs = agent_working_time_rollups.failed_runs + EXCLUDED.failed_runs,
                        partial_runs = agent_working_time_rollups.partial_runs + EXCLUDED.partial_runs`,
            );
          },
        );
      });

      orgsSucceeded++;
      logger.info(`${SOURCE}.org_completed`, {
        jobRunId,
        orgId: org.id,
        durationMs: Date.now() - orgStart,
        status: 'success',
      });
    } catch (err) {
      orgsFailed++;
      logger.error(`${SOURCE}.org_failed`, {
        jobRunId,
        orgId: org.id,
        error: err instanceof Error ? err.message : String(err),
        errorClass: err instanceof Error ? 'tx_failure' : 'unknown',
        status: 'failed',
      });
    }
  }

  const status: WorkingTimeRollupCompactResult['status'] =
    orgsFailed === 0 ? 'success'
    : orgsSucceeded === 0 ? 'failed'
    : 'partial';

  const result: WorkingTimeRollupCompactResult = {
    status,
    orgsAttempted: orgs.length,
    orgsSucceeded,
    orgsFailed,
    durationMs: Date.now() - startedAt,
  };

  logger.info(`${SOURCE}.completed`, { jobRunId, ...result });
  return result;
}
