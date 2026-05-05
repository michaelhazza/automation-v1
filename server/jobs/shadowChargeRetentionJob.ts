/**
 * shadowChargeRetentionJob — daily purge of shadow_settled agent_charges past
 * the per-org retention window.
 *
 * Runs daily at 03:30 UTC via pg-boss (registered in queueService.startMaintenanceJobs).
 *
 * This job is the ONLY DB path that may delete agent_charges rows (spec §14,
 * invariant: append-only enforcement has a retention_purge carve-out). The
 * trigger permits DELETEs when app.spend_caller = 'retention_purge'.
 *
 * Per-org contract:
 *   - Reads organisations.shadow_charge_retention_days for each org.
 *   - Deletes shadow_settled rows whose settled_at is past the per-org window.
 *   - Per-row failures are logged and skipped; they do not abort the sweep.
 *
 * Cross-org sweep contract:
 *   - Uses withAdminConnection + SET LOCAL ROLE admin_role to bypass RLS.
 *   - Sets app.spend_caller = 'retention_purge' before each DELETE so the
 *     trigger's carve-out permits the operation.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logChargeTransition } from '../lib/spendLogging.js';
import { logger } from '../lib/logger.js';
import {
  resolveShadowRetentionDays,
  computeShadowRetentionCutoff,
  decideShadowRetention,
  type ShadowRetentionSummary,
  type ShadowSettledRow,
} from './shadowChargeRetentionJobPure.js';

/** Default retention if org column is out-of-range or misconfigured. */
const DEFAULT_SHADOW_RETENTION_DAYS = 90;

/** Maximum rows deleted per org per tick to bound wall-clock impact. */
const MAX_DELETE_PER_ORG = 10_000;

export async function runShadowChargeRetentionSweep(): Promise<ShadowRetentionSummary> {
  const started = Date.now();
  const now = new Date();

  let orgs = 0;
  let totalScanned = 0;
  let totalDeleted = 0;
  let totalSkipped = 0;

  await withAdminConnection(
    {
      source: 'jobs.shadowChargeRetentionJob',
      reason: 'Daily purge of shadow_settled agent_charges past per-org retention window',
    },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      // Read per-org retention config in one round-trip.
      const orgRows = (await tx.execute(sql`
        SELECT id AS organisation_id, shadow_charge_retention_days
        FROM organisations
        WHERE deleted_at IS NULL
      `)) as unknown as Array<{
        organisation_id: string;
        shadow_charge_retention_days: number;
      }> | { rows?: Array<{ organisation_id: string; shadow_charge_retention_days: number }> };

      const orgList: Array<{ organisation_id: string; shadow_charge_retention_days: number }> =
        Array.isArray(orgRows)
          ? orgRows
          : Array.isArray((orgRows as { rows?: unknown[] })?.rows)
            ? (orgRows as { rows: Array<{ organisation_id: string; shadow_charge_retention_days: number }> }).rows!
            : [];

      orgs = orgList.length;

      for (const orgRow of orgList) {
        const retentionDays = resolveShadowRetentionDays(
          orgRow.shadow_charge_retention_days,
          DEFAULT_SHADOW_RETENTION_DAYS,
        );
        const cutoff = computeShadowRetentionCutoff(now, retentionDays);

        // Fetch candidates for this org bounded by MAX_DELETE_PER_ORG.
        const candidatesRaw = (await tx.execute(sql`
          SELECT id, status, settled_at
          FROM agent_charges
          WHERE organisation_id = ${orgRow.organisation_id}::uuid
            AND status = 'shadow_settled'
            AND settled_at < ${cutoff.toISOString()}::timestamptz
          ORDER BY settled_at ASC
          LIMIT ${MAX_DELETE_PER_ORG}
        `)) as unknown as Array<{ id: string; status: string; settled_at: string | Date | null }> | { rows?: Array<{ id: string; status: string; settled_at: string | Date | null }> };

        const candidates: Array<{ id: string; status: string; settled_at: string | Date | null }> =
          Array.isArray(candidatesRaw)
            ? candidatesRaw
            : Array.isArray((candidatesRaw as { rows?: unknown[] })?.rows)
              ? (candidatesRaw as { rows: Array<{ id: string; status: string; settled_at: string | Date | null }> }).rows!
              : [];

        totalScanned += candidates.length;

        for (const candidate of candidates) {
          const row: ShadowSettledRow = {
            id: candidate.id,
            status: candidate.status,
            settledAt: candidate.settled_at ? new Date(candidate.settled_at as string) : null,
          };

          const decision = decideShadowRetention(row, cutoff);

          if (!decision.shouldDelete) {
            totalSkipped += 1;
            continue;
          }

          try {
            // MUST set app.spend_caller = 'retention_purge' so the trigger's
            // carve-out permits this DELETE (spec §14, plan Chunk 16).
            await tx.execute(sql`SET LOCAL app.spend_caller = 'retention_purge'`);

            const deletedRaw = (await tx.execute(sql`
              DELETE FROM agent_charges
              WHERE id = ${candidate.id}::uuid
                AND status = 'shadow_settled'
              RETURNING id
            `)) as unknown as Array<{ id: string }> | { rows?: Array<{ id: string }> };

            const deletedRows: Array<{ id: string }> =
              Array.isArray(deletedRaw)
                ? deletedRaw
                : Array.isArray((deletedRaw as { rows?: unknown[] })?.rows)
                  ? (deletedRaw as { rows: Array<{ id: string }> }).rows!
                  : [];

            if (deletedRows.length > 0) {
              totalDeleted += 1;
              logChargeTransition({
                chargeId: candidate.id,
                from: 'shadow_settled',
                to: 'shadow_settled',
                reason: 'retention_purge',
                caller: 'retention_purge',
              });
            }
          } catch (err) {
            // Per-row failures must not abort the sweep. A trigger reject
            // (row no longer shadow_settled) is the expected failure mode.
            totalSkipped += 1;
            logger.warn('shadow_retention.delete_failed', {
              chargeId: candidate.id,
              organisationId: orgRow.organisation_id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    },
  );

  const summary: ShadowRetentionSummary = {
    orgs,
    scanned: totalScanned,
    deleted: totalDeleted,
    skipped: totalSkipped,
    durationMs: Date.now() - started,
  };

  logger.info('shadow_charge_retention_sweep', { ...summary });

  return summary;
}
