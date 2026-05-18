import { withAdminConnection } from '../../lib/adminDbConnection.js';
import { harnessRunHistory } from '../../db/schema/harnessRunHistory.js';
import { logger } from '../../lib/logger.js';
import { toRow } from './harnessHistoryWriterPure.js';
import type { HarnessRunResult } from './harnessHistoryWriterPure.js';

/**
 * Writes a `HarnessRunResult` to `harness_run_history`.
 *
 * Uses `withAdminConnection` because `harness_run_history` is system-scoped
 * (no `organisation_id`) and has no RLS — getOrgScopedDb is not applicable.
 *
 * On DB write error: logs `harness.history.write_failed` and throws so the
 * caller can decide whether to swallow (CI exit code is in-memory-driven
 * per spec §6.4 and is unaffected by a writer failure).
 */
export async function write(result: HarnessRunResult): Promise<void> {
  const row = toRow(result);

  try {
    await withAdminConnection(
      { source: 'harnessHistoryWriter', skipAudit: true },
      async (tx) => {
        await tx.insert(harnessRunHistory).values(row);
      },
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    logger.error('harness.history.write_failed', { siteSlug: result.siteSlug, code });
    throw err;
  }
}

// Re-export the type so callers can import it from the writer module without
// also importing the pure module directly.
export type { HarnessRunResult };
