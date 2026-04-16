/**
 * memoryHnswReindexJob — one-shot HNSW index rebuild trigger
 *
 * Enqueued by memoryEntryDecayJob when the pruned count for a subaccount
 * crosses REINDEX_THRESHOLD. Re-issues REINDEX on the workspace_memory_entries
 * HNSW index to reclaim tombstoned space and improve search quality after
 * a large prune.
 *
 * REINDEX cannot run inside a transaction block; it is executed via the
 * raw pool client. This is a maintenance operation on an index, not a
 * data read — no RLS bypass is required.
 *
 * Idempotent: REINDEX is safe to run multiple times. Concurrent reindex
 * jobs for different subaccounts are both safe (they rebuild the same
 * shared index, which is fine since the second REINDEX is a no-op on an
 * already-rebuilt index).
 *
 * Spec: docs/memory-and-briefings-spec.md §4.1 (S1)
 */

import { client } from '../db/index.js';

export interface MemoryHnswReindexPayload {
  subaccountId: string;
}

export async function runMemoryHnswReindex(
  payload: MemoryHnswReindexPayload,
): Promise<void> {
  const { subaccountId } = payload;
  const started = Date.now();

  console.info(
    JSON.stringify({ event: 'memory_hnsw_reindex_start', subaccountId }),
  );

  // REINDEX cannot run inside a transaction block; execute directly
  // on the pool client (postgres-js `client` object supports raw queries).
  await client.unsafe('REINDEX INDEX workspace_memory_entries_embedding_hnsw');

  console.info(
    JSON.stringify({
      event: 'memory_hnsw_reindex_complete',
      subaccountId,
      durationMs: Date.now() - started,
    }),
  );
}
