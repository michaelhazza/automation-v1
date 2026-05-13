// ---------------------------------------------------------------------------
// Memory-utility MV refresh — repopulates `mv_memory_utility_30d` nightly.
//
// Called by server/jobs/refreshMemoryUtility30dJob.ts (the pg-boss entry
// point).
//
// RLS note: cross-tenant aggregate read via withAdminConnectionGuarded.
// mv_memory_utility_30d is excluded from RLS (see server/db/rlsExclusions.ts).
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
// allowRlsBypass: cross-tenant aggregate refresh for memory-utility MV
import { withAdminConnectionGuarded } from '../lib/rlsBoundaryGuard.js';
import { logger } from '../lib/logger.js';

export async function runMemoryUtilityRefresh(): Promise<void> {
  const started = Date.now();

  try {
    await withAdminConnectionGuarded(
      {
        source: 'memory_utility_refresh',
        // allowRlsBypass: cross-tenant aggregate refresh for memory-utility materialised view
        allowRlsBypass: true,
        reason: 'cross-tenant aggregate refresh for memory-utility materialised view',
      },
      async (tx) => {
        const lockResult = await tx.execute<{ acquired: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(hashtext('memory_utility.refresh')) AS acquired`,
        );
        const acquired = lockResult[0]?.acquired ?? false;

        if (!acquired) {
          logger.info('memory_utility.refresh.skipped_locked');
          return;
        }

        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        await tx.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_memory_utility_30d`);
      },
    );

    logger.info('memory_utility.refresh.completed', { durationMs: Date.now() - started });
  } catch (err) {
    logger.warn('memory_utility.refresh.attempt_failed', {
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
