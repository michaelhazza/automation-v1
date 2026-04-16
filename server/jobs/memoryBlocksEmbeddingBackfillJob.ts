/**
 * memoryBlocksEmbeddingBackfillJob — one-shot embedding backfill for memory_blocks
 *
 * Iterates all memory_blocks where `embedding IS NULL AND deleted_at IS NULL`,
 * batches them, generates embeddings, and writes them back. Scheduled once on
 * Phase 2 deploy; safe to re-run (idempotent — only touches NULL rows).
 *
 * Without embeddings, all blocks score zero in the relevance retrieval
 * pipeline (S6), so this backfill MUST complete before S6 relevance retrieval
 * is enabled in production.
 *
 * Spec: docs/memory-and-briefings-spec.md §5.2 (S6)
 */

import { eq, and, isNull, inArray, notInArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { memoryBlocks } from '../db/schema/index.js';
import { generateEmbedding, formatVectorLiteral } from '../lib/embeddings.js';
import { sql } from 'drizzle-orm';

const BATCH_SIZE = 50;

export interface BackfillSummary {
  scanned: number;
  embedded: number;
  skipped: number;
  failed: number;
  durationMs: number;
}

/**
 * Runs the backfill sweep. Returns a summary.
 *
 * @param limit optional cap on total rows processed (for bounded test runs).
 */
export async function runMemoryBlocksEmbeddingBackfill(
  limit?: number,
): Promise<BackfillSummary> {
  const started = Date.now();
  let scanned = 0;
  let embedded = 0;
  let skipped = 0;
  let failed = 0;

  // Track IDs of empty-content blocks so they are excluded from subsequent
  // batches. Without this exclusion the while-true loop would re-fetch the
  // same empty row on every iteration and never terminate.
  const skippedIds: string[] = [];

  while (true) {
    if (limit !== undefined && scanned >= limit) break;

    const batchLimit = limit !== undefined
      ? Math.min(BATCH_SIZE, limit - scanned)
      : BATCH_SIZE;

    // Fetch a batch of blocks without embeddings, excluding already-skipped rows
    const whereClause = skippedIds.length > 0
      ? and(
          isNull(memoryBlocks.embedding),
          isNull(memoryBlocks.deletedAt),
          notInArray(memoryBlocks.id, skippedIds),
        )
      : and(
          isNull(memoryBlocks.embedding),
          isNull(memoryBlocks.deletedAt),
        );

    const batch = await db
      .select({ id: memoryBlocks.id, content: memoryBlocks.content })
      .from(memoryBlocks)
      .where(whereClause)
      .limit(batchLimit);

    if (batch.length === 0) break;

    scanned += batch.length;

    for (const row of batch) {
      if (!row.content || row.content.trim().length === 0) {
        skipped += 1;
        skippedIds.push(row.id);
        continue;
      }

      try {
        const vec = await generateEmbedding(row.content);
        if (!vec) {
          failed += 1;
          continue;
        }

        // Write back the embedding using raw SQL cast (vector type)
        const literal = formatVectorLiteral(vec);
        await db.execute(sql`
          UPDATE memory_blocks
          SET embedding = ${literal}::vector(1536),
              updated_at = NOW()
          WHERE id = ${row.id} AND embedding IS NULL AND deleted_at IS NULL
        `);
        embedded += 1;
      } catch (err) {
        failed += 1;
        console.error(
          JSON.stringify({
            event: 'memory_blocks_embedding_backfill_row_failed',
            blockId: row.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  }

  const summary: BackfillSummary = {
    scanned,
    embedded,
    skipped,
    failed,
    durationMs: Date.now() - started,
  };

  console.info(
    JSON.stringify({ event: 'memory_blocks_embedding_backfill_complete', ...summary }),
  );

  return summary;
}
