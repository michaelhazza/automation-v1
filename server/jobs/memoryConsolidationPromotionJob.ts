/**
 * memoryConsolidationPromotionJob — hourly tier-promotion sweep.
 *
 * Iterates every active (organisation_id, subaccount_id) pair. For each tenant
 * opens an org-scoped transaction and invokes dispatchPromotionsForTenant.
 * Individual tenant failures are logged but do not abort the sweep.
 *
 * Exits early when MEMORY_CONSOLIDATION_TIER_ENABLED is OFF.
 *
 * Registered in pgBossRegistrations.ts as queue 'memory-consolidation-promotion',
 * schedule '0 * * * *' (hourly).
 *
 * Spec: docs/superpowers/specs/2026-05-18-memory-tiered-consolidation-spec.md §6 Phase 4,
 * §8, §9.5, §11.4
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
import { getMemoryConsolidationTierEnabled } from '../config/featureFlags.js';
import { dispatchPromotionsForTenant } from '../services/memoryConsolidationPromotionDispatcher.js';
import { logger } from '../lib/logger.js';
import type { DispatchSummary } from '../services/memoryConsolidationPromotionDispatcher.js';

interface TenantRow {
  organisation_id: string;
  subaccount_id: string;
}

export async function runMemoryConsolidationPromotion(): Promise<void> {
  if (!getMemoryConsolidationTierEnabled()) {
    logger.info('memory.consolidation.promotion_job.skipped', { flag: 'off' });
    return;
  }

  // Enumerate all active tenants via admin connection (cross-org read).
  const rows = (await db.execute(sql`
    SELECT DISTINCT organisation_id, subaccount_id
    FROM workspace_memory_entries
    WHERE deleted_at IS NULL
    ORDER BY organisation_id, subaccount_id
  `)) as unknown as TenantRow[] | { rows?: TenantRow[] };

  const tenants: TenantRow[] = Array.isArray(rows) ? rows : (rows as { rows?: TenantRow[] }).rows ?? [];

  const totals: DispatchSummary = {
    auto_promotions_applied: 0,
    auto_promotions_attempted_but_lost_race: 0,
    procedural_promotions_queued: 0,
    procedural_promotions_skipped_in_cooldown: 0,
    invalid_transition_skipped: 0,
    evaluation_errors: 0,
  };

  for (const tenant of tenants) {
    const { organisation_id: organisationId, subaccount_id: subaccountId } = tenant;
    try {
      let tenantSummary: DispatchSummary | undefined;

      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`,
        );
        await withOrgTx(
          { tx, organisationId, subaccountId, source: 'memoryConsolidationPromotionJob' },
          async () => {
            tenantSummary = await dispatchPromotionsForTenant(organisationId, subaccountId);
          },
        );
      });

      if (tenantSummary) {
        totals.auto_promotions_applied += tenantSummary.auto_promotions_applied;
        totals.auto_promotions_attempted_but_lost_race += tenantSummary.auto_promotions_attempted_but_lost_race;
        totals.procedural_promotions_queued += tenantSummary.procedural_promotions_queued;
        totals.procedural_promotions_skipped_in_cooldown += tenantSummary.procedural_promotions_skipped_in_cooldown;
        totals.invalid_transition_skipped += tenantSummary.invalid_transition_skipped;
        totals.evaluation_errors += tenantSummary.evaluation_errors;
      }
    } catch (err) {
      totals.evaluation_errors += 1;
      logger.error('memory.consolidation.promotion_job.tenant_failed', {
        organisationId,
        subaccountId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const event = totals.evaluation_errors === 0
    ? 'memory.consolidation.promotion_job.completed'
    : 'memory.consolidation.promotion_job.partial';

  logger.info(event, {
    tenantsProcessed: tenants.length,
    ...totals,
  });
}
