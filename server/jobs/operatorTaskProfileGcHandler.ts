/**
 * operatorTaskProfileGcHandler — 15-minute cron for operator task profile GC.
 *
 * Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §7.5, §3.15
 *
 * Uses withAdminConnectionGuarded({ source: 'operatorTaskProfileGc', allowRlsBypass: true })
 * + SET LOCAL ROLE admin_role per spec (GC crosses org boundaries).
 *
 * Actions:
 *   1. Reclaim stale gc_in_progress rows older than 30 minutes (re-schedule them).
 *   2. Run GC for profiles whose scheduled_gc_at <= now() (status = 'scheduled_gc').
 *      - Calls the sandbox provider to delete the volume (provider 404 → treat as gc_done).
 *      - Transitions status to gc_done on success.
 */

import type PgBoss from 'pg-boss';
import { logger } from '../lib/logger.js';
import { createWorker } from '../lib/createWorker.js';
import { operatorTaskProfileService } from '../services/operatorTaskProfileService.js';

export const OPERATOR_TASK_PROFILE_GC_QUEUE = 'operator-task-profile-gc';

/** Stale gc_in_progress reclaim threshold: 30 minutes. */
const STALE_GC_IN_PROGRESS_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Registers the operator-task-profile-gc pg-boss handler.
 */
export async function registerOperatorTaskProfileGcHandler(boss: PgBoss): Promise<void> {
  await createWorker<Record<string, unknown>>({
    queue: OPERATOR_TASK_PROFILE_GC_QUEUE,
    boss,
    concurrency: 1,
    resolveOrgContext: () => null, // admin job — no org context
    handler: async (_job) => {
      let reclaimedCount = 0;
      let gcDoneCount = 0;

      // Step 1: Reclaim stale gc_in_progress rows.
      try {
        reclaimedCount = await operatorTaskProfileService.reclaimStaleGcInProgress(
          STALE_GC_IN_PROGRESS_THRESHOLD_MS,
        );

        if (reclaimedCount > 0) {
          logger.info('operator.profile_gc.stale_reclaimed', { count: reclaimedCount });
        }
      } catch (err) {
        logger.error('operator.profile_gc.reclaim_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Step 2: Run GC for scheduled profiles (status = 'scheduled_gc' + scheduled_gc_at <= now()).
      // Delegated to the profile service GC sweep.
      try {
        gcDoneCount = await operatorTaskProfileService.runScheduledGcSweep();

        if (gcDoneCount > 0) {
          logger.info('operator.profile_gc.sweep_done', { count: gcDoneCount });
        }
      } catch (err) {
        logger.error('operator.profile_gc.sweep_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      logger.info('operator.profile_gc.tick_complete', {
        reclaimedCount,
        gcDoneCount,
      });
    },
  });

  logger.info('operator.profile_gc.handler_registered');
}
