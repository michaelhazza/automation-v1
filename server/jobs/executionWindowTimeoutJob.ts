/**
 * executionWindowTimeoutJob — scans approved charges past expires_at
 * and transitions them to failed/execution_timeout.
 *
 * Runs every minute via pg-boss (registered in queueService.startMaintenanceJobs).
 *
 * Cross-org sweep contract:
 *   - Uses `withAdminConnection` + `SET LOCAL ROLE admin_role` to bypass RLS
 *     for the cross-tenant sweep. Without the role switch, the UPDATE would
 *     hit fail-closed RLS and update zero rows.
 *
 * Concurrency model (architecture.md §3312):
 *   - pg-boss deduplicates across instances natively; teamSize=1 ensures only
 *     one concurrent execution of this job.
 *   - Optimistic compare-and-set (WHERE status = 'approved') prevents races
 *     with other writers (e.g. executeApproved completing concurrently).
 *
 * Invariant 11: MUST NOT touch `executed` rows — WHERE clause scoped to
 * `status = 'approved'` only.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logChargeTransition } from '../lib/spendLogging.js';
import { logger } from '../lib/logger.js';
import {
  deriveCutoff,
  decideTimeout,
  type ExecutionWindowTimeoutSummary,
  type ExpiredApprovedRow,
} from './executionWindowTimeoutJobPure.js';

export async function runExecutionWindowTimeoutSweep(): Promise<ExecutionWindowTimeoutSummary> {
  const started = Date.now();
  const now = new Date();
  const cutoff = deriveCutoff(now);

  let scanned = 0;
  let timedOut = 0;
  let skipped = 0;

  await withAdminConnection(
    {
      source: 'jobs.executionWindowTimeoutJob',
      reason: 'Sweep approved agent_charges past expires_at',
    },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      const candidates = (await tx.execute(sql.raw(`
        SELECT id, status, expires_at
        FROM agent_charges
        WHERE status = 'approved'
          AND expires_at < '${cutoff.toISOString()}'::timestamptz
        LIMIT 1000
      `))) as unknown as Array<{ id: string; status: string; expires_at: string | Date | null }> | { rows?: Array<{ id: string; status: string; expires_at: string | Date | null }> };

      const rows: Array<{ id: string; status: string; expires_at: string | Date | null }> = Array.isArray(candidates)
        ? candidates
        : Array.isArray((candidates as { rows?: unknown[] })?.rows)
          ? ((candidates as { rows: Array<{ id: string; status: string; expires_at: string | Date | null }> }).rows)
          : [];

      scanned = rows.length;

      for (const row of rows) {
        const expiredRow: ExpiredApprovedRow = {
          id: row.id,
          status: row.status,
          expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
        };

        const decision = decideTimeout(expiredRow, now);

        if (!decision.shouldTimeout) {
          skipped += 1;
          continue;
        }

        try {
          await tx.execute(sql`SET LOCAL app.spend_caller = 'timeout_job'`);
          const updated = (await tx.execute(sql`
            UPDATE agent_charges
            SET
              status = 'failed',
              failure_reason = 'execution_timeout',
              settled_at = ${now.toISOString()}::timestamptz,
              last_transition_by = 'timeout_job',
              updated_at = ${now.toISOString()}::timestamptz
            WHERE id = ${row.id}::uuid
              AND status = 'approved'
            RETURNING id
          `)) as unknown as Array<{ id: string }> | { rows?: Array<{ id: string }> };

          const updatedRows = Array.isArray(updated)
            ? updated
            : Array.isArray((updated as { rows?: unknown[] })?.rows)
              ? ((updated as { rows: Array<{ id: string }> }).rows)
              : [];

          if (updatedRows.length > 0) {
            timedOut += 1;
            logChargeTransition({
              chargeId: row.id,
              from: 'approved',
              to: 'failed',
              reason: 'execution_timeout',
              caller: 'timeout_job',
            });
          }
        } catch (err) {
          logger.warn('execution_window_timeout.update_failed', {
            chargeId: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
  );

  const summary: ExecutionWindowTimeoutSummary = {
    scanned,
    timedOut,
    skipped,
    durationMs: Date.now() - started,
  };

  logger.info('execution_window_timeout_sweep', { ...summary });

  return summary;
}
