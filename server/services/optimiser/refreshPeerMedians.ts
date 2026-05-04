// ---------------------------------------------------------------------------
// Peer-medians refresh — repopulates the `optimiser_skill_peer_medians`
// materialised view on a nightly schedule.
//
// Called by server/jobs/refreshOptimiserPeerMedians.ts (the pg-boss entry
// point).
//
// RLS note: cross-tenant aggregate read via withAdminConnectionGuarded.
// optimiser_skill_peer_medians is a materialised view excluded from RLS
// (see server/db/rlsExclusions.ts).
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
// allowRlsBypass: cross-tenant aggregate refresh for peer-medians materialised view
import { withAdminConnectionGuarded } from '../../lib/rlsBoundaryGuard.js';
import { logger } from '../../lib/logger.js';

export async function runPeerMediansRefresh(): Promise<void> {
  const started = Date.now();
  logger.info('optimiser.peer_medians.refresh.started');

  try {
    await withAdminConnectionGuarded(
      {
        source: 'optimiser_peer_medians_refresh',
        allowRlsBypass: true,
        reason: 'cross-tenant aggregate refresh for peer-medians materialised view',
      },
      async (tx) => {
        // Acquire a transaction-scoped advisory lock to prevent concurrent
        // refreshes. pg_try_advisory_xact_lock returns false immediately if
        // another session holds the lock (non-blocking).
        const lockResult = await tx.execute<{ acquired: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(hashtext('optimiser.peer_medians.refresh')) AS acquired`,
        );
        const acquired = lockResult[0]?.acquired ?? false;

        if (!acquired) {
          logger.info('optimiser.peer_medians.refresh.skipped_locked');
          return;
        }

        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        await tx.execute(sql`REFRESH MATERIALIZED VIEW optimiser_skill_peer_medians`);
      },
    );

    logger.info('optimiser.peer_medians.refresh.completed', { durationMs: Date.now() - started });
  } catch (err) {
    logger.error('optimiser.peer_medians.refresh.failed', {
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
