/**
 * visionInferenceCostRollupJob.ts — daily rollup of vision_inference_calls into cost_aggregates.
 *
 * Spec: docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md §10, §13.
 *
 * Mirrors server/jobs/ieeCostRollupDailyJob.ts:
 *   - withAdminConnection + SET LOCAL ROLE admin_role for cross-tenant aggregation.
 *   - UTC day boundary: `created_at AT TIME ZONE 'UTC'` before date_trunc.
 *   - Look-back: 2 days.
 *   - Two upserts:
 *       (a) entity_type='source_type', entity_id='vision_inference' — platform aggregate.
 *       (b) entity_type='run', entity_id=run_id::text — per-run aggregate consumed
 *           by runCostBreaker. Enforcement applies from the FOLLOWING run onward
 *           (spec §1 Goal 6; mid-run enforcement deferred — spec §13).
 *   - ON CONFLICT (entity_type, entity_id, period_type, period_key) DO UPDATE.
 *   - Schedule: '15 2 * * *' UTC (5-minute offset from IEE rollup at '10 2 * * *').
 *
 * Schedule-registration invariant: pg-boss boss.schedule(name, cron, ...) is
 * idempotent by name (matches ieeCostRollupDailyJob).
 */
import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import { getPgBoss } from '../lib/pgBossInstance.js';

const QUEUE_NAME = 'vision-inference-cost-rollup-daily';
const SCHEDULE_CRON = '15 2 * * *'; // 02:15 UTC daily

/**
 * Core rollup logic — two upserts into cost_aggregates:
 *   1. Platform aggregate (entity_type='source_type', entity_id='vision_inference').
 *   2. Per-run aggregate (entity_type='run', entity_id=run_id::text) so runCostBreaker
 *      picks up vision inference spend alongside other run-grain cost rows.
 *
 * Exposed for targeted unit testing and manual invocation via
 * `boss.send('vision-inference-cost-rollup-daily', {})`.
 */
export async function runVisionInferenceCostRollup(): Promise<{ durationMs: number }> {
  const started = Date.now();

  await withAdminConnection(
    {
      source: 'jobs.visionInferenceCostRollupDaily',
      reason: 'cross-tenant aggregation of vision_inference_calls into cost_aggregates; daily rollup job',
    },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      // Platform-grain aggregate (entity_type='source_type', entity_id='vision_inference').
      //
      // Note on UTC day boundary: created_at is timestamptz, so a bare
      // `date_trunc('day', created_at)` truncates at the DB session
      // timezone — which is not guaranteed to be UTC. `created_at AT TIME ZONE 'UTC'`
      // evaluates the timestamptz in UTC before truncation, pinning the bucket to the
      // UTC day regardless of DB/session config (mirrors ieeCostRollupDailyJob pattern).
      await tx.execute(sql`
        INSERT INTO cost_aggregates (
          organisation_id, entity_type, entity_id, period_type, period_key,
          total_cost_raw, total_cost_with_margin, total_cost_cents,
          total_tokens_in, total_tokens_out, request_count, error_count,
          updated_at
        )
        SELECT
          organisation_id,
          'source_type' AS entity_type,
          'vision_inference' AS entity_id,
          'daily' AS period_type,
          to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period_key,
          0, 0,
          COALESCE(SUM(cost_cents), 0)::integer,
          0, 0,
          COUNT(*)::integer,
          0,
          now()
        FROM vision_inference_calls
        WHERE created_at >= now() - interval '2 days'
        GROUP BY organisation_id, date_trunc('day', created_at AT TIME ZONE 'UTC')
        ON CONFLICT (entity_type, entity_id, period_type, period_key)
        DO UPDATE SET
          total_cost_cents = EXCLUDED.total_cost_cents,
          request_count    = EXCLUDED.request_count,
          updated_at       = now();
      `);

      // Per-run aggregate (entity_type='run', entity_id=run_id::text).
      // runCostBreaker looks up cost_aggregates rows with entity_type='run';
      // this upsert ensures vision inference spend is visible to it.
      await tx.execute(sql`
        INSERT INTO cost_aggregates (
          organisation_id, entity_type, entity_id, period_type, period_key,
          total_cost_raw, total_cost_with_margin, total_cost_cents,
          total_tokens_in, total_tokens_out, request_count, error_count,
          updated_at
        )
        SELECT
          organisation_id,
          'run' AS entity_type,
          run_id::text AS entity_id,
          'daily' AS period_type,
          to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period_key,
          0, 0,
          COALESCE(SUM(cost_cents), 0)::integer,
          0, 0,
          COUNT(*)::integer,
          0,
          now()
        FROM vision_inference_calls
        WHERE created_at >= now() - interval '2 days'
        GROUP BY organisation_id, run_id, date_trunc('day', created_at AT TIME ZONE 'UTC')
        ON CONFLICT (entity_type, entity_id, period_type, period_key)
        DO UPDATE SET
          total_cost_cents = EXCLUDED.total_cost_cents,
          request_count    = EXCLUDED.request_count,
          updated_at       = now();
      `);
    },
  );

  const summary = { durationMs: Date.now() - started };
  logger.info('vision_inference.costrollup.complete', summary);
  return summary;
}

/**
 * Register the worker + cron schedule with pg-boss. Idempotent by queue
 * name. Emits a positive `vision_inference.costrollup.scheduled` log line so
 * the manual smoke gate can confirm the cron is registered without relying on
 * absence-of-error.
 */
export async function registerVisionInferenceCostRollupJob(): Promise<void> {
  if (env.JOB_QUEUE_BACKEND !== 'pg-boss') {
    logger.warn('vision_inference.costrollup.skipped', { reason: 'pg-boss not configured' });
    return;
  }
  const boss = await getPgBoss();
  await boss.work(QUEUE_NAME, async () => {
    await runVisionInferenceCostRollup();
  });
  await boss.schedule(QUEUE_NAME, SCHEDULE_CRON, {}, { tz: 'UTC' });
  logger.info('vision_inference.costrollup.scheduled', { queue: QUEUE_NAME, cron: SCHEDULE_CRON });
}
