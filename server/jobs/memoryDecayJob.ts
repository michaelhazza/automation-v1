/**
 * Memory decay pruning job — Mem0 pattern.
 *
 * Runs daily to prune workspace memory entries that are:
 *   - older than 90 days
 *   - low quality (quality_score < 0.3)
 *   - rarely accessed (access_count < 3)
 *
 * All three conditions must be true. This protects high-quality, frequently-used
 * memories from decay while clearing out low-value noise.
 */

import { pruneStaleMemoryEntries } from '../services/workspaceMemoryService.js';

export async function runMemoryDecay(): Promise<void> {
  const count = await pruneStaleMemoryEntries();
  console.info(`[MemoryDecay] Pruned ${count} stale memory entries`);
}
