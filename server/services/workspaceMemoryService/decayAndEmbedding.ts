import { and, lt, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { workspaceMemoryEntries } from '../../db/schema/index.js';
import { generateEmbedding, formatVectorLiteral } from '../../lib/embeddings.js';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Memory decay pruning (called by daily job)
// ---------------------------------------------------------------------------

export async function pruneStaleMemoryEntries(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90); // 90-day window

  const pruned = await getOrgScopedDb('decayAndEmbedding.pruneStaleMemoryEntries')
    .delete(workspaceMemoryEntries)
    .where(
      and(
        lt(workspaceMemoryEntries.createdAt, cutoff),
        sql`(quality_score IS NOT NULL AND quality_score < 0.3)`,
        sql`access_count < 3`,
      )
    )
    .returning({ id: workspaceMemoryEntries.id });

  return pruned.length;
}

// ---------------------------------------------------------------------------
// Embedding invalidation helpers (review §2.1, item 7, §3.2)
//
// Single shared re-embed function used by:
//   - Phase 1 insert path (no context to reset; row is brand new)
//   - Dedup UPDATE path (content drifted; old context is stale)
//   - getStaleEmbeddingsBatch / recomputeStaleEmbeddings ops helpers
//
// Process-local in-flight guard prevents duplicate concurrent re-embeds for
// the same entry. This collapses bursts (e.g. several agent runs touching the
// same entry within seconds) into a single LLM call. Local to the process —
// across processes, a duplicate may still happen, but the partial index will
// quickly settle to a clean state because each re-embed write is idempotent.
// ---------------------------------------------------------------------------

const inFlightReembeds = new Set<string>();

/**
 * Recompute the embedding for a single entry and stamp embedding_content_hash.
 * Returns true on success, false if skipped (duplicate in flight) or failed.
 *
 * `resetContext` controls whether to clear `embedding_context` — the dedup
 * UPDATE and ops backfill paths set this to true (the existing context was
 * generated for the OLD content and is now misleading); the brand-new insert
 * path sets it to false (there is no context yet to clear).
 */
export async function reembedEntry(params: {
  id: string;
  content: string;
  resetContext: boolean;
}): Promise<boolean> {
  if (inFlightReembeds.has(params.id)) return false;
  inFlightReembeds.add(params.id);
  try {
    const embedding = await generateEmbedding(params.content);
    if (!embedding) return false;
    const contentHash = createHash('md5').update(params.content).digest('hex');
    const reembedScopedDb = getOrgScopedDb('decayAndEmbedding.reembedEntry');
    if (params.resetContext) {
      await reembedScopedDb.execute(
        sql`UPDATE workspace_memory_entries
               SET embedding = ${formatVectorLiteral(embedding)}::vector,
                   embedding_computed_at = NOW(),
                   embedding_content_hash = ${contentHash},
                   embedding_context = NULL
             WHERE id = ${params.id}`
      );
    } else {
      await reembedScopedDb.execute(
        sql`UPDATE workspace_memory_entries
               SET embedding = ${formatVectorLiteral(embedding)}::vector,
                   embedding_computed_at = NOW(),
                   embedding_content_hash = ${contentHash}
             WHERE id = ${params.id}`
      );
    }
    return true;
  } catch {
    // Non-fatal — the partial index will resurface this entry on the next sweep.
    return false;
  } finally {
    inFlightReembeds.delete(params.id);
  }
}

/**
 * Return up to `limit` entries whose embedding has drifted from their content
 * (review item 7). Backed by the partial index from migration 0151, so this
 * is O(stale), not O(rows). Optional `subaccountId` scopes the scan.
 *
 * Use cases: nightly cron, ops dashboards, post-migration sanity checks.
 */
export async function getStaleEmbeddingsBatch(params: {
  subaccountId?: string;
  limit?: number;
} = {}): Promise<Array<{ id: string; content: string }>> {
  const limit = Math.max(1, Math.min(1000, params.limit ?? 100));
  const staleScopedDb = getOrgScopedDb('decayAndEmbedding.getStaleEmbeddingsBatch');
  const result = params.subaccountId
    ? await staleScopedDb.execute(sql`
        SELECT id, content
          FROM workspace_memory_entries
         WHERE embedding IS NOT NULL
           AND embedding_content_hash IS DISTINCT FROM content_hash
           AND deleted_at IS NULL
           AND subaccount_id = ${params.subaccountId}
         LIMIT ${limit}
      `)
    : await staleScopedDb.execute(sql`
        SELECT id, content
          FROM workspace_memory_entries
         WHERE embedding IS NOT NULL
           AND embedding_content_hash IS DISTINCT FROM content_hash
           AND deleted_at IS NULL
         LIMIT ${limit}
      `);
  // postgres-js returns rows directly as an array on db.execute
  return (result as unknown as Array<{ id: string; content: string }>) ?? [];
}

/**
 * Recompute up to `limit` stale embeddings serially. Returns scan vs success
 * vs skipped counts so callers can monitor convergence and distinguish
 * transient failures from in-flight collisions.
 *
 * Serial (not parallel) on purpose: embedding generation is rate-limited at
 * the provider, and a 100-entry batch already takes long enough that
 * bursting is wasteful.
 */
export async function recomputeStaleEmbeddings(params: {
  subaccountId?: string;
  limit?: number;
} = {}): Promise<{ scanned: number; recomputed: number; skipped: number }> {
  const stale = await getStaleEmbeddingsBatch(params);
  let recomputed = 0;
  let skipped = 0;
  for (const entry of stale) {
    const ok = await reembedEntry({
      id: entry.id,
      content: entry.content,
      resetContext: true,
    });
    if (ok) recomputed++;
    else skipped++;
  }
  return { scanned: stale.length, recomputed, skipped };
}
