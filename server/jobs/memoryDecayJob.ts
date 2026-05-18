/**
 * Memory decay job — Phase 2 tiered-consolidation observability sweep.
 *
 * Runs hourly. When the MEMORY_CONSOLIDATION_TIER_ENABLED flag is ON,
 * iterates every active (organisation_id, subaccount_id) pair and emits
 * one structured log line per consolidation_tier with access-distribution
 * counts. No rows are written — decay is applied at retrieval time in
 * hybridRetrieval; last_accessed_at is owned by the reinforcement batch.
 *
 * When the flag is OFF the job exits immediately after one log line.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';
import { getMemoryConsolidationTierEnabled } from '../config/featureFlags.js';

interface TierDistributionRow {
  consolidation_tier: string;
  count_total: string | number;
  count_within_7d: string | number;
  count_older_30d: string | number;
  count_null: string | number;
}

interface TenantRow {
  organisation_id: string;
  subaccount_id: string;
}

export async function runMemoryDecay(): Promise<void> {
  if (!getMemoryConsolidationTierEnabled()) {
    logger.info('memory.decay_job.skipped', { flag: 'off' });
    return;
  }

  await withAdminConnection(
    { source: 'jobs.memoryDecayJob', reason: 'Hourly cross-org tier distribution log sweep' },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      const tenantsResult = (await tx.execute(sql`
        SELECT DISTINCT organisation_id, subaccount_id
        FROM workspace_memory_entries
        WHERE deleted_at IS NULL
        ORDER BY organisation_id, subaccount_id
      `)) as unknown as TenantRow[] | { rows?: TenantRow[] };

      const tenants: TenantRow[] = Array.isArray(tenantsResult)
        ? tenantsResult
        : (tenantsResult as { rows?: TenantRow[] }).rows ?? [];

      for (const tenant of tenants) {
        const { organisation_id: organisationId, subaccount_id: subaccountId } = tenant;
        try {
          const countResult = (await tx.execute(sql`
            SELECT
              consolidation_tier,
              COUNT(*)                                                              AS count_total,
              COUNT(*) FILTER (WHERE last_accessed_at >= now() - interval '7 days') AS count_within_7d,
              COUNT(*) FILTER (WHERE last_accessed_at < now() - interval '30 days') AS count_older_30d,
              COUNT(*) FILTER (WHERE last_accessed_at IS NULL)                     AS count_null
            FROM workspace_memory_entries
            WHERE deleted_at IS NULL
              AND organisation_id = ${organisationId}
              AND subaccount_id   = ${subaccountId}
            GROUP BY consolidation_tier
          `)) as unknown as TierDistributionRow[] | { rows?: TierDistributionRow[] };

          const tierRows: TierDistributionRow[] = Array.isArray(countResult)
            ? countResult
            : (countResult as { rows?: TierDistributionRow[] }).rows ?? [];

          for (const row of tierRows) {
            logger.info('memory.decay_job.cycle', {
              organisationId,
              subaccountId,
              tier: row.consolidation_tier,
              countTotal: Number(row.count_total),
              countAccessedWithin7d: Number(row.count_within_7d),
              countNotAccessedSince30d: Number(row.count_older_30d),
              countNullLastAccessedAt: Number(row.count_null),
            });
          }
        } catch (err) {
          logger.error('memory.decay_job.tenant_failed', {
            organisationId,
            subaccountId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
  );
}
