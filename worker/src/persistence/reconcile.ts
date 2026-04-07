// ---------------------------------------------------------------------------
// Worker startup reconciliation. Spec §13.3.
// Any iee_runs row left in 'running' by a worker that has not heartbeated
// within IEE_HEARTBEAT_DEAD_AFTER_S — and is NOT this worker — is moved to
// 'failed' with failureReason='environment_error'.
// ---------------------------------------------------------------------------

import { and, eq, lt, ne, inArray } from 'drizzle-orm';
import { db } from '../db.js';
import { ieeRuns } from '../../../server/db/schema/ieeRuns.js';
import { budgetReservations } from '../../../server/db/schema/budgetReservations.js';
import { env } from '../config/env.js';
import { logger } from '../logger.js';

export async function reconcileAbandonedRuns(currentWorkerInstanceId: string): Promise<void> {
  const cutoff = new Date(Date.now() - env.IEE_HEARTBEAT_DEAD_AFTER_S * 1000);

  // The mark-failed and reservation-release MUST happen in the same
  // transaction so we never leak a reservation past the lifecycle of its run.
  // Spec §13.3 + reviewer feedback round 2.
  const result = await db.transaction(async (tx) => {
    const failed = await tx
      .update(ieeRuns)
      .set({
        status: 'failed',
        failureReason: 'environment_error',
        completedAt: new Date(),
        resultSummary: {
          success: false,
          output: 'Worker died before completing the run (heartbeat reconciliation)',
          stepCount: 0,
          durationMs: 0,
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ieeRuns.status, 'running'),
          lt(ieeRuns.lastHeartbeatAt, cutoff),
          ne(ieeRuns.workerInstanceId, currentWorkerInstanceId),
        ),
      )
      .returning({ id: ieeRuns.id });

    if (failed.length > 0) {
      const reservationKeys = failed.map(r => `iee:${r.id}`);
      await tx
        .update(budgetReservations)
        .set({ status: 'released' })
        .where(inArray(budgetReservations.idempotencyKey, reservationKeys));
    }

    return failed;
  });

  if (result.length > 0) {
    logger.warn('iee.worker.reconciled_abandoned_runs', {
      count: result.length,
      cutoffSeconds: env.IEE_HEARTBEAT_DEAD_AFTER_S,
    });
    // Reviewer round 3 #2 — audit each release individually so cost
    // discrepancies in the future can be traced to a specific worker death.
    for (const r of result) {
      logger.info('iee.reservation.released.reconciliation', {
        ieeRunId: r.id,
        reason: 'worker_crash',
        cutoffSeconds: env.IEE_HEARTBEAT_DEAD_AFTER_S,
      });
    }
  }
}
