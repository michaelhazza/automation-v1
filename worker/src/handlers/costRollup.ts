// ---------------------------------------------------------------------------
// iee-cost-rollup-daily — daily aggregation into cost_aggregates.
// Spec §11.3.5.
//
// Writes per-organisation, per-day rows to the existing cost_aggregates table
// using entityType='iee_run' (LLM cost) and entityType='iee_runtime' (compute
// cost). Existing dashboards already understand the cost_aggregates surface.
// ---------------------------------------------------------------------------

import type PgBoss from 'pg-boss';
import { client } from '../db.js';
import { logger } from '../logger.js';

const QUEUE = 'iee-cost-rollup-daily';

export async function registerCostRollupHandler(boss: PgBoss): Promise<void> {
  await boss.work(QUEUE, { teamSize: 1, teamConcurrency: 1 }, async () => {
    await runRollup();
  });

  // Schedule daily at 02:10 UTC
  try {
    await boss.schedule(QUEUE, '10 2 * * *');
  } catch (err) {
    logger.warn('iee.costrollup.schedule_failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

async function runRollup(): Promise<void> {
  // Look back 2 days so a re-run can catch any late-arriving completions.
  const upserted = await client.unsafe(`
    INSERT INTO cost_aggregates (
      entity_type, entity_id, period_type, period_key,
      total_cost_raw, total_cost_with_margin, total_cost_cents,
      total_tokens_in, total_tokens_out, request_count, error_count,
      updated_at
    )
    SELECT
      'iee_run' AS entity_type,
      organisation_id::text AS entity_id,
      'daily' AS period_type,
      to_char(date_trunc('day', completed_at), 'YYYY-MM-DD') AS period_key,
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
    GROUP BY organisation_id, date_trunc('day', completed_at)
    ON CONFLICT (entity_type, entity_id, period_type, period_key)
    DO UPDATE SET
      total_cost_cents = EXCLUDED.total_cost_cents,
      request_count    = EXCLUDED.request_count,
      error_count      = EXCLUDED.error_count,
      updated_at       = now();
  `);

  await client.unsafe(`
    INSERT INTO cost_aggregates (
      entity_type, entity_id, period_type, period_key,
      total_cost_raw, total_cost_with_margin, total_cost_cents,
      total_tokens_in, total_tokens_out, request_count, error_count,
      updated_at
    )
    SELECT
      'iee_runtime' AS entity_type,
      organisation_id::text AS entity_id,
      'daily' AS period_type,
      to_char(date_trunc('day', completed_at), 'YYYY-MM-DD') AS period_key,
      0, 0,
      COALESCE(SUM(runtime_cost_cents), 0)::integer,
      0, 0,
      COUNT(*)::integer,
      0,
      now()
    FROM iee_runs
    WHERE completed_at >= now() - interval '2 days'
      AND deleted_at IS NULL
    GROUP BY organisation_id, date_trunc('day', completed_at)
    ON CONFLICT (entity_type, entity_id, period_type, period_key)
    DO UPDATE SET
      total_cost_cents = EXCLUDED.total_cost_cents,
      request_count    = EXCLUDED.request_count,
      updated_at       = now();
  `);

  logger.info('iee.costrollup.complete', { rowsUpserted: upserted.count });
}
