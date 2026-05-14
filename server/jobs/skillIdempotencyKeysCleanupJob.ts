/**
 * skillIdempotencyKeysCleanupJob — nightly retention sweep for skill_idempotency_keys.
 *
 * Deletes rows where expires_at IS NOT NULL AND expires_at < NOW() in batches
 * of 1,000 with a 10,000-row safety cap per run. Permanent-class rows
 * (expires_at IS NULL) are never matched.
 *
 * Schedule: daily at 05:30 UTC in queueService.ts.
 */
import { sql } from 'drizzle-orm';
import { assertRlsAwareWrite } from '../lib/rlsBoundaryGuard.js';
// Use withAdminConnection to bypass RLS for the cross-org sweep
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';

const BATCH_SIZE = 1_000;
const MAX_ROWS_PER_RUN = 10_000;
const SOURCE = 'skillIdempotencyKeysCleanupJob';

export async function runSkillIdempotencyKeysCleanup(): Promise<void> {
  let totalDeleted = 0;
  let batchCount = 0;
  const start = Date.now();

  await withAdminConnection(
    { source: SOURCE, reason: 'Nightly retention sweep of skill_idempotency_keys' },
    async (adminDb) => {
      while (totalDeleted < MAX_ROWS_PER_RUN) {
        // allowRlsBypass: cross-org admin maintenance sweep — deletes expired rows
        // across all subaccounts, bypass of per-org RLS is intentional.
        assertRlsAwareWrite('skill_idempotency_keys', SOURCE);
        const result = await adminDb.execute(sql`
          DELETE FROM skill_idempotency_keys
          WHERE ctid IN (
            SELECT ctid FROM skill_idempotency_keys
            WHERE expires_at IS NOT NULL AND expires_at < NOW()
            LIMIT ${BATCH_SIZE}
          )
        `);
        const deleted = (result as unknown as { rowCount?: number }).rowCount ?? 0;
        totalDeleted += deleted;
        batchCount += 1;
        // Spec §16.3 — per-batch log emit (AC #32)
        logger.info('skill_idempotency_keys.cleanup.batch', { batch: batchCount, rows: deleted });
        if (deleted < BATCH_SIZE) break;
      }
    },
  );

  // Spec §16.3 — terminal completion log emit (AC #32)
  logger.info('skill_idempotency_keys.cleanup.complete', {
    total: totalDeleted,
    batches: batchCount,
    duration_ms: Date.now() - start,
  });
}
