// server/jobs/benchRegressionReplayJob.ts
// Bench regression replay — re-runs a bench when an approved model's provider
// version updates. Enqueues a new bench:execute job for the approved bench run.
// Trust & Verification Layer spec §12.4.

import { and, eq, isNull, sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';
import { getPgBoss } from '../lib/pgBossInstance.js';

export interface BenchRegressionReplayPayload {
  /** Provider model version that updated (e.g. 'claude-haiku-4-5-20251001'). */
  updatedModelId: string;
}

/**
 * Finds all completed bench_runs that approved the given model and re-enqueues
 * them for a fresh bench:execute run so regressions surface automatically.
 *
 * Runs with admin privileges (cross-org sweep) — scoped by approved_model_id
 * which is a safe narrow filter. Each re-enqueued job runs with the original
 * organisationId so it picks up org-scoped RLS for result writes.
 */
export async function benchRegressionReplayJobHandler(
  job: { data: BenchRegressionReplayPayload },
): Promise<void> {
  const { updatedModelId } = job.data;

  if (!updatedModelId) {
    logger.warn('bench_regression_replay.missing_model_id');
    return;
  }

  await withAdminConnection(
    {
      source: 'jobs.benchRegressionReplay',
      reason: `Bench regression replay triggered by model version update: ${updatedModelId}`,
    },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      // Find all completed bench runs that approved the updated model
      const rows = await tx.execute(sql`
        SELECT id, organisation_id, candidate_model_ids, sample_count, target_agent_id
        FROM bench_runs
        WHERE approved_model_id = ${updatedModelId}
          AND state = 'completed'
        ORDER BY completed_at DESC
        LIMIT 100
      `);

      const runs = rows as unknown as Array<{
        id: string;
        organisation_id: string;
        candidate_model_ids: unknown;
        sample_count: number;
        target_agent_id: string | null;
      }>;

      if (runs.length === 0) {
        logger.info('bench_regression_replay.no_runs', { updatedModelId });
        return;
      }

      const boss = await getPgBoss();
      let enqueued = 0;

      for (const run of runs) {
        try {
          // Create a new bench_run row for the replay and enqueue it.
          // The replay inserts a fresh awaiting_confirm → running row using
          // the same candidates and sample count as the original run.
          await tx.execute(sql`
            INSERT INTO bench_runs (
              organisation_id,
              triggered_by_user_id,
              target_agent_id,
              state,
              candidate_model_ids,
              sample_count,
              started_at,
              updated_at
            )
            SELECT
              organisation_id,
              triggered_by_user_id,
              target_agent_id,
              'running',
              candidate_model_ids,
              sample_count,
              now(),
              now()
            FROM bench_runs WHERE id = ${run.id}
            RETURNING id
          `);

          // Get the new run ID from the insert
          const [newRow] = await tx.execute(sql`
            SELECT id FROM bench_runs
            WHERE organisation_id = ${run.organisation_id}
              AND state = 'running'
              AND target_agent_id IS NOT DISTINCT FROM ${run.target_agent_id}
            ORDER BY created_at DESC
            LIMIT 1
          `) as unknown as Array<{ id: string }>;

          if (newRow?.id) {
            await (boss as any).send('bench:execute', {
              benchRunId: newRow.id,
              organisationId: run.organisation_id,
            });
            enqueued += 1;
          }
        } catch (err) {
          logger.warn('bench_regression_replay.enqueue_failed', {
            originalBenchRunId: run.id,
            updatedModelId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      logger.info('bench_regression_replay.complete', {
        updatedModelId,
        totalFound: runs.length,
        enqueued,
      });
    },
  );
}
