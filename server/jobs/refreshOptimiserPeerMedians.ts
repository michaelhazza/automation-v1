/**
 * refreshOptimiserPeerMedians — pg-boss job (Chunk 2, F2 Sub-Account Optimiser)
 *
 * Refreshes the optimiser_skill_peer_medians materialised view and updates
 * optimiser_view_metadata.refreshed_at. Scheduled daily at 00:00 UTC.
 *
 * Strategy:
 *   1. Try REFRESH MATERIALIZED VIEW CONCURRENTLY (non-blocking for readers).
 *   2. If concurrent refresh fails (e.g. no unique index or lock contention),
 *      fall back to a blocking REFRESH MATERIALIZED VIEW.
 *   3. On success, upsert optimiser_view_metadata to record the refresh time.
 *      This row is read by skillLatency.ts before joining the view — if it is
 *      absent or older than 24 h, the skill-latency scan is suppressed.
 *
 * Idempotency: safe — REFRESH is a no-op on an already-current view; the
 * metadata UPSERT is idempotent. idempotencyStrategy: 'one-shot' (daily cron).
 *
 * Uses withAdminConnection + SET LOCAL ROLE admin_role because the view is
 * system-scoped (cross-tenant) and bypasses RLS by design (spec §3 access
 * posture: zero per-tenant rows, only aggregates above 5-tenant minimum).
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';

const SOURCE = 'refresh_optimiser_peer_medians';
const VIEW_NAME = 'optimiser_skill_peer_medians';

export interface RefreshOptimiserPeerMediansResult {
  status: 'success' | 'failed';
  method: 'concurrent' | 'blocking' | 'none';
  durationMs: number;
  error?: string;
}

export async function refreshOptimiserPeerMedians(): Promise<RefreshOptimiserPeerMediansResult> {
  const startedAt = Date.now();
  logger.info(`${SOURCE}.started`);

  let method: 'concurrent' | 'blocking' | 'none' = 'none';

  try {
    await withAdminConnection(
      {
        source: SOURCE,
        reason: 'nightly refresh of optimiser_skill_peer_medians materialised view',
        skipAudit: true,
      },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        // --- Step 1: Attempt concurrent refresh (non-blocking for readers) ---
        let refreshSucceeded = false;
        try {
          await tx.execute(
            sql`REFRESH MATERIALIZED VIEW CONCURRENTLY optimiser_skill_peer_medians`,
          );
          method = 'concurrent';
          refreshSucceeded = true;
          logger.info(`${SOURCE}.concurrent_refresh_succeeded`);
        } catch (concurrentErr) {
          // Concurrent refresh requires a unique index. If it fails for any
          // reason (unique index missing, pg version issue, etc.), fall back.
          logger.warn(`${SOURCE}.concurrent_refresh_failed_falling_back`, {
            error:
              concurrentErr instanceof Error
                ? concurrentErr.message
                : String(concurrentErr),
          });
        }

        if (!refreshSucceeded) {
          // --- Step 2: Blocking refresh fallback ---
          await tx.execute(
            sql`REFRESH MATERIALIZED VIEW optimiser_skill_peer_medians`,
          );
          method = 'blocking';
          logger.info(`${SOURCE}.blocking_refresh_succeeded`);
        }

        // --- Step 3: Update staleness metadata ---
        await tx.execute(sql`
          INSERT INTO optimiser_view_metadata (view_name, refreshed_at)
          VALUES (${VIEW_NAME}, now())
          ON CONFLICT (view_name)
          DO UPDATE SET refreshed_at = excluded.refreshed_at
        `);

        logger.info(`${SOURCE}.metadata_updated`, { view_name: VIEW_NAME });
      },
    );

    const durationMs = Date.now() - startedAt;
    logger.info(`${SOURCE}.completed`, { method, durationMs });
    return { status: 'success', method, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);
    logger.error(`${SOURCE}.failed`, { error, durationMs });
    return { status: 'failed', method: 'none', durationMs, error };
  }
}
