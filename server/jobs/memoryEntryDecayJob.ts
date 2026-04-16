/**
 * memoryEntryDecayJob — nightly memory quality decay + pruning
 *
 * Runs nightly (scheduled in queueService.ts). Per subaccount work units:
 * for each active subaccount, applies quality decay then prunes entries
 * that have fallen below the prune threshold.
 *
 * Flow:
 *   1. Fetch all active subaccount IDs for the organisation.
 *   2. For each subaccount:
 *      a. applyDecay(subaccountId)
 *      b. pruneLowQuality(subaccountId)
 *      c. If pruneSummary.pruned >= REINDEX_THRESHOLD, enqueue one-shot
 *         memory-hnsw-reindex job.
 *   3. Log weekly pruned-count summary.
 *
 * Failures on individual subaccounts are caught and logged — a single bad
 * subaccount does not abort the entire sweep.
 *
 * Spec: docs/memory-and-briefings-spec.md §4.1 (S1)
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { applyDecay, pruneLowQuality } from '../services/memoryEntryQualityService.js';
import { REINDEX_THRESHOLD } from '../config/limits.js';

export interface MemoryEntryDecaySummary {
  subaccountsProcessed: number;
  totalDecayed: number;
  totalPruned: number;
  reindexJobsQueued: number;
  skipped: number;
  durationMs: number;
}

/**
 * Main job entry point. Called by the queueService worker.
 * Accepts an optional `queueSend` function for dependency injection in tests.
 */
export async function runMemoryEntryDecay(
  queueSend?: (queue: string, data: object) => Promise<unknown>,
): Promise<MemoryEntryDecaySummary> {
  const started = Date.now();
  let subaccountsProcessed = 0;
  let totalDecayed = 0;
  let totalPruned = 0;
  let reindexJobsQueued = 0;
  let skipped = 0;

  // Fetch all active (non-deleted) subaccount IDs
  const rows = (await db.execute(sql`
    SELECT id FROM subaccounts
    WHERE deleted_at IS NULL AND status = 'active'
    ORDER BY id
  `)) as unknown as Array<{ id: string }> | { rows?: Array<{ id: string }> };

  const subaccountIds: string[] = (
    Array.isArray(rows) ? rows : (rows as any).rows ?? []
  ).map((r: { id: string }) => r.id);

  for (const subaccountId of subaccountIds) {
    try {
      const decaySummary = await applyDecay(subaccountId);
      const pruneSummary = await pruneLowQuality(subaccountId);

      totalDecayed += decaySummary.decayed;
      totalPruned += pruneSummary.pruned;

      if (pruneSummary.pruned >= REINDEX_THRESHOLD && queueSend) {
        await queueSend('memory-hnsw-reindex', { subaccountId });
        reindexJobsQueued += 1;
      }

      subaccountsProcessed += 1;
    } catch (err) {
      skipped += 1;
      console.error(
        JSON.stringify({
          event: 'memory_entry_decay_subaccount_failed',
          subaccountId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  const summary: MemoryEntryDecaySummary = {
    subaccountsProcessed,
    totalDecayed,
    totalPruned,
    reindexJobsQueued,
    skipped,
    durationMs: Date.now() - started,
  };

  console.info(
    JSON.stringify({ event: 'memory_entry_decay_tick_complete', ...summary }),
  );

  return summary;
}
