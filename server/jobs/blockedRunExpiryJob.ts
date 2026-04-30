/**
 * blockedRunExpiryJob — sweeps agent_runs with expired integration blocks.
 *
 * Runs every 5 minutes via pg-boss (registered in queueService.startMaintenanceJobs).
 * For every run whose blocked_expires_at < now(), transitions the run to
 * status='cancelled' / run_result_status='failed' and sets cancelReason in
 * runMetadata so the conversation shows a clear message.
 *
 * This is the cleanup path for runs where the user never connected the
 * required integration within the 24-hour window.
 */

import { and, lt, isNotNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentRuns } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';

export interface BlockedRunExpirySummary {
  expiredCount: number;
  durationMs: number;
}

export async function runFn(): Promise<BlockedRunExpirySummary> {
  const started = Date.now();
  const now = new Date();

  // Atomically transition all expired blocked runs to cancelled.
  // Clear the block columns so the expiry sweep is idempotent.
  const expired = await db
    .update(agentRuns)
    .set({
      status: 'cancelled',
      runResultStatus: 'failed',
      blockedReason: null,
      blockedExpiresAt: null,
      integrationResumeToken: null,
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        isNotNull(agentRuns.blockedReason),
        lt(agentRuns.blockedExpiresAt, now),
      ),
    )
    .returning({ id: agentRuns.id });

  // Write cancelReason into runMetadata using jsonb_set (cannot merge JSONB
  // atomically in a single Drizzle update without a raw expression).
  for (const run of expired) {
    try {
      await db.execute(
        sql`UPDATE agent_runs
            SET run_metadata = jsonb_set(COALESCE(run_metadata, '{}'), '{cancelReason}', '"integration_connect_timeout"')
            WHERE id = ${run.id}`,
      );
      logger.info('run_blocked_expired', {
        runId: run.id,
        action: 'run_blocked_expired',
      });
    } catch (err) {
      logger.warn('blocked_run_expiry.metadata_write_failed', {
        runId: run.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary: BlockedRunExpirySummary = {
    expiredCount: expired.length,
    durationMs: Date.now() - started,
  };

  logger.info('blocked_run_expiry_sweep', {
    ...summary,
    action: 'blocked_run_expiry_sweep',
  });

  return summary;
}
