/**
 * ieeCostRollupDailyJob.ts — daily IEE cost rollup into cost_aggregates.
 *
 * Migrated from worker/src/handlers/costRollup.ts as part of the
 * iee-worker-retirement build (tasks/builds/iee-worker-retirement/spec.md §4
 * Chunk 1). The standalone worker process is being retired; this cron now
 * runs on the main server.
 *
 * Writes per-organisation, per-day rows to the cost_aggregates table using
 * entityType='iee_run' (LLM cost) and entityType='iee_runtime' (compute
 * cost). Looks back 2 days so a re-run catches any late-arriving
 * completions.
 *
 * Schedule-registration invariant: pg-boss `boss.schedule(name, cron, ...)`
 * is idempotent by name. Re-registering across deploys updates the existing
 * row rather than duplicating. Spec §4 Chunk 1.
 *
 * Note on organisation_id: migration 0272 added a NOT NULL organisation_id
 * column to cost_aggregates. The original worker SQL pre-dated that
 * migration and did not supply the column — this version sources it from
 * the GROUP BY so the upsert satisfies the constraint.
 */
import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import { getPgBoss } from '../lib/pgBossInstance.js';

const QUEUE_NAME = 'iee-cost-rollup-daily';
const SCHEDULE_CRON = '10 2 * * *'; // 02:10 UTC daily

/**
 * Core rollup logic — two parallel upserts into cost_aggregates, one per
 * entity_type ('iee_run' for LLM cost, 'iee_runtime' for compute cost).
 *
 * Exposed for targeted unit testing and manual invocation via
 * `boss.send('iee-cost-rollup-daily', {})`.
 */
export async function runIeeCostRollup(): Promise<{ durationMs: number }> {
  const started = Date.now();

  await withAdminConnection(
    {
      source: 'jobs.ieeCostRollupDaily',
      reason: 'cross-tenant aggregation of iee_runs into cost_aggregates; daily rollup job',
    },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      // LLM cost rollup (entity_type='iee_run').
      //
      // Note on entity_id: 'iee_run' and 'iee_runtime' rollups are
      // organisation-grain by design (one row per org per day), not
      // per-iee_run. entity_id therefore holds organisation_id::text as
      // the deliberate join key; the entity_uniq constraint
      // (entity_type, entity_id, period_type, period_key) dedups per
      // org-per-day. organisation_id is set on its own column for RLS.
      //
      // Note on UTC day boundary: completed_at is timestamptz, so a bare
      // `date_trunc('day', completed_at)` truncates at the DB session
      // timezone — which is not guaranteed to be UTC. The cron schedule is
      // explicitly UTC (`tz: 'UTC'` in pg-boss schedule) and the period_key
      // must mean UTC-daily so the (entity_type, entity_id, period_type,
      // period_key) uniqueness key behaves consistently across deploys.
      // `completed_at AT TIME ZONE 'UTC'` evaluates the timestamptz in UTC
      // before truncation, pinning the bucket to the UTC day regardless of
      // DB/session config.
      await tx.execute(sql`
        INSERT INTO cost_aggregates (
          organisation_id, entity_type, entity_id, period_type, period_key,
          total_cost_raw, total_cost_with_margin, total_cost_cents,
          total_tokens_in, total_tokens_out, request_count, error_count,
          updated_at
        )
        SELECT
          organisation_id,
          'iee_run' AS entity_type,
          organisation_id::text AS entity_id,
          'daily' AS period_type,
          to_char(date_trunc('day', completed_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period_key,
          0 AS total_cost_raw,
          0 AS total_cost_with_margin,
          COALESCE(SUM(llm_cost_cents), 0)::integer AS total_cost_cents,
          0 AS total_tokens_in,
          0 AS total_tokens_out,
          COUNT(*)::integer AS request_count,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::integer AS error_count,
          now() AS updated_at
        FROM iee_runs
        WHERE completed_at >= now() - interval '2 days'
          AND deleted_at IS NULL
        GROUP BY organisation_id, date_trunc('day', completed_at AT TIME ZONE 'UTC')
        ON CONFLICT (entity_type, entity_id, period_type, period_key)
        DO UPDATE SET
          total_cost_cents = EXCLUDED.total_cost_cents,
          request_count    = EXCLUDED.request_count,
          error_count      = EXCLUDED.error_count,
          updated_at       = now();
      `);

      // Runtime/compute cost rollup (entity_type='iee_runtime').
      // Same UTC day-boundary discipline as the LLM rollup above — see comment.
      await tx.execute(sql`
        INSERT INTO cost_aggregates (
          organisation_id, entity_type, entity_id, period_type, period_key,
          total_cost_raw, total_cost_with_margin, total_cost_cents,
          total_tokens_in, total_tokens_out, request_count, error_count,
          updated_at
        )
        SELECT
          organisation_id,
          'iee_runtime' AS entity_type,
          organisation_id::text AS entity_id,
          'daily' AS period_type,
          to_char(date_trunc('day', completed_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period_key,
          0, 0,
          COALESCE(SUM(runtime_cost_cents), 0)::integer,
          0, 0,
          COUNT(*)::integer,
          0,
          now()
        FROM iee_runs
        WHERE completed_at >= now() - interval '2 days'
          AND deleted_at IS NULL
        GROUP BY organisation_id, date_trunc('day', completed_at AT TIME ZONE 'UTC')
        ON CONFLICT (entity_type, entity_id, period_type, period_key)
        DO UPDATE SET
          total_cost_cents = EXCLUDED.total_cost_cents,
          request_count    = EXCLUDED.request_count,
          updated_at       = now();
      `);
    },
  );

  const summary = { durationMs: Date.now() - started };
  logger.info('iee.costrollup.complete', summary);
  return summary;
}

/**
 * Register the worker + cron schedule with pg-boss. Idempotent by queue
 * name. Emits a positive `iee.costrollup.scheduled` log line so the manual
 * smoke gate per spec §5 can confirm the cron is registered without
 * relying on absence-of-error.
 */
export async function registerIeeCostRollupDailyJob(): Promise<void> {
  if (env.JOB_QUEUE_BACKEND !== 'pg-boss') {
    logger.warn('iee.costrollup.skipped', { reason: 'pg-boss not configured' });
    return;
  }
  const boss = await getPgBoss();
  await boss.work(QUEUE_NAME, async () => {
    await runIeeCostRollup();
  });
  await boss.schedule(QUEUE_NAME, SCHEDULE_CRON, {}, { tz: 'UTC' });
  logger.info('iee.costrollup.scheduled', { queue: QUEUE_NAME, cron: SCHEDULE_CRON });
}
