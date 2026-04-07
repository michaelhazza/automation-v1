// ---------------------------------------------------------------------------
// Worker startup reconciliation. Spec §13.3.
// Any iee_runs row left in 'running' by a worker that has not heartbeated
// within IEE_HEARTBEAT_DEAD_AFTER_S — and is NOT this worker — is moved to
// 'failed' with failureReason='environment_error'.
// ---------------------------------------------------------------------------

import { and, eq, lt, ne, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { ieeRuns } from '../../../server/db/schema/ieeRuns.js';
import { env } from '../config/env.js';
import { logger } from '../logger.js';

export async function reconcileAbandonedRuns(currentWorkerInstanceId: string): Promise<void> {
  const cutoff = new Date(Date.now() - env.IEE_HEARTBEAT_DEAD_AFTER_S * 1000);
  const result = await db
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

  if (result.length > 0) {
    logger.warn('iee.worker.reconciled_abandoned_runs', {
      count: result.length,
      cutoffSeconds: env.IEE_HEARTBEAT_DEAD_AFTER_S,
    });
  }
}
