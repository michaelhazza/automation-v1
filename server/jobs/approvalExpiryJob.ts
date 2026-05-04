/**
 * approvalExpiryJob — scans pending_approval charges past approval_expires_at
 * and transitions them to denied/approval_expired.
 *
 * Runs every minute via pg-boss (registered in queueService.startMaintenanceJobs).
 *
 * Cross-org sweep contract:
 *   - Uses `withAdminConnection` + `SET LOCAL ROLE admin_role` to bypass RLS.
 *
 * Concurrency model (architecture.md §3312):
 *   - pg-boss deduplicates across instances natively; teamSize=1.
 *   - Optimistic compare-and-set (WHERE status = 'pending_approval') prevents races.
 *
 * Invariant 12: scoped to `pending_approval` ONLY — approval_expires_at is inert
 * once a row leaves that status.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logChargeTransition } from '../lib/spendLogging.js';
import { logger } from '../lib/logger.js';
import {
  deriveApprovalCutoff,
  decideApprovalExpiry,
  type ApprovalExpirySummary,
  type ExpiredPendingApprovalRow,
} from './approvalExpiryJobPure.js';

export async function runApprovalExpirySweep(): Promise<ApprovalExpirySummary> {
  const started = Date.now();
  const now = new Date();
  const cutoff = deriveApprovalCutoff(now);

  let scanned = 0;
  let expired = 0;
  let skipped = 0;

  await withAdminConnection(
    {
      source: 'jobs.approvalExpiryJob',
      reason: 'Sweep pending_approval agent_charges past approval_expires_at',
    },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      const candidates = (await tx.execute(sql.raw(`
        SELECT id, status, approval_expires_at
        FROM agent_charges
        WHERE status = 'pending_approval'
          AND approval_expires_at < '${cutoff.toISOString()}'::timestamptz
        LIMIT 1000
      `))) as unknown as Array<{ id: string; status: string; approval_expires_at: string | Date | null }> | { rows?: Array<{ id: string; status: string; approval_expires_at: string | Date | null }> };

      const rows: Array<{ id: string; status: string; approval_expires_at: string | Date | null }> = Array.isArray(candidates)
        ? candidates
        : Array.isArray((candidates as { rows?: unknown[] })?.rows)
          ? ((candidates as { rows: Array<{ id: string; status: string; approval_expires_at: string | Date | null }> }).rows)
          : [];

      scanned = rows.length;

      for (const row of rows) {
        const pendingRow: ExpiredPendingApprovalRow = {
          id: row.id,
          status: row.status,
          approvalExpiresAt: row.approval_expires_at ? new Date(row.approval_expires_at as string) : null,
        };

        const decision = decideApprovalExpiry(pendingRow, now);

        if (!decision.shouldExpire) {
          skipped += 1;
          continue;
        }

        try {
          await tx.execute(sql`SET LOCAL app.spend_caller = 'approval_expiry_job'`);
          const updated = (await tx.execute(sql`
            UPDATE agent_charges
            SET
              status = 'denied',
              failure_reason = 'approval_expired',
              settled_at = ${now.toISOString()}::timestamptz,
              last_transition_by = 'approval_expiry_job',
              updated_at = ${now.toISOString()}::timestamptz
            WHERE id = ${row.id}::uuid
              AND status = 'pending_approval'
            RETURNING id
          `)) as unknown as Array<{ id: string }> | { rows?: Array<{ id: string }> };

          const updatedRows = Array.isArray(updated)
            ? updated
            : Array.isArray((updated as { rows?: unknown[] })?.rows)
              ? ((updated as { rows: Array<{ id: string }> }).rows)
              : [];

          if (updatedRows.length > 0) {
            expired += 1;
            logChargeTransition({
              chargeId: row.id,
              from: 'pending_approval',
              to: 'denied',
              reason: 'approval_expired',
              caller: 'approval_expiry_job',
            });
          }
        } catch (err) {
          logger.warn('approval_expiry.update_failed', {
            chargeId: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
  );

  const summary: ApprovalExpirySummary = {
    scanned,
    expired,
    skipped,
    durationMs: Date.now() - started,
  };

  logger.info('approval_expiry_sweep', { ...summary });

  return summary;
}
