/**
 * Memory deduplication job — Phase 2B of Agent Intelligence Upgrade.
 *
 * Runs on a schedule to find near-duplicate workspace memory entries using
 * pgvector cosine distance. For each subaccount that has embeddings, it
 * identifies entry pairs with cosine distance < 0.15 (~85 % similarity),
 * keeps the highest-quality entry, and hard-deletes the duplicates.
 *
 * Processing is batched per-subaccount to keep memory pressure reasonable
 * and allow logging at a useful granularity.
 */

import type PgBoss from 'pg-boss';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workspaceMemoryEntries } from '../db/schema/index.js';

const QUEUE_NAME = 'maintenance:memory-dedup';
const SCHEDULE_CRON = '30 4 * * *'; // 4:30 AM daily — after memory-decay (3 AM) and agent-run-cleanup (4 AM)

/** Cosine distance threshold — pairs closer than this are near-duplicates. */
const COSINE_DISTANCE_THRESHOLD = 0.15;

/**
 * Run one full deduplication sweep across all subaccounts.
 */
export async function runMemoryDedup(): Promise<void> {
  // Step 1: collect subaccounts that have at least one embedded entry.
  const subaccounts: { subaccountId: string }[] = await db
    .selectDistinct({ subaccountId: workspaceMemoryEntries.subaccountId })
    .from(workspaceMemoryEntries)
    .where(sql`${workspaceMemoryEntries.embedding} IS NOT NULL`);

  let totalDeleted = 0;

  for (const { subaccountId } of subaccounts) {
    const deleted = await deduplicateSubaccount(subaccountId);
    if (deleted > 0) {
      console.info(
        `[MemoryDedup] Removed ${deleted} duplicate entries for subaccount ${subaccountId}`,
      );
    }
    totalDeleted += deleted;
  }

  console.info(`[MemoryDedup] Sweep complete — removed ${totalDeleted} duplicate entries across ${subaccounts.length} subaccounts`);
}

/**
 * For a single subaccount, find near-duplicate pairs and delete the lower
 * quality entry from each pair.
 *
 * The query self-joins `workspace_memory_entries` on cosine distance and
 * keeps only pairs where `a.id < b.id` to avoid counting each pair twice.
 * From each pair the entry with the lower quality_score is marked for
 * deletion; ties are broken by id to ensure determinism.
 *
 * Returns the number of deleted rows.
 */
async function deduplicateSubaccount(subaccountId: string): Promise<number> {
  // Identify IDs to delete in a single query:
  //   - Self-join on cosine distance < threshold
  //   - a.id < b.id avoids double-counting
  //   - For each pair, delete the entry with the lower quality_score
  //     (or the one with the greater id on tie)
  const result = await db.execute<{ id: string }>(sql`
    DELETE FROM workspace_memory_entries
    WHERE id IN (
      SELECT DISTINCT
        CASE
          WHEN COALESCE(a.quality_score, 0) < COALESCE(b.quality_score, 0) THEN a.id
          WHEN COALESCE(a.quality_score, 0) > COALESCE(b.quality_score, 0) THEN b.id
          ELSE (CASE WHEN a.id > b.id THEN a.id ELSE b.id END)
        END AS loser_id
      FROM workspace_memory_entries a
      JOIN workspace_memory_entries b
        ON a.subaccount_id = b.subaccount_id
       AND a.id < b.id
       AND a.embedding IS NOT NULL
       AND b.embedding IS NOT NULL
       AND (a.embedding <=> b.embedding) < ${COSINE_DISTANCE_THRESHOLD}
      WHERE a.subaccount_id = ${subaccountId}
    )
    RETURNING id
  `);

  return result.length;
}

// ---------------------------------------------------------------------------
// Registration — wire the worker + schedule onto a pg-boss instance
// ---------------------------------------------------------------------------

export async function registerMemoryDedupJob(boss: PgBoss): Promise<void> {
  await (boss as any).work(QUEUE_NAME, { teamSize: 1, teamConcurrency: 1 }, async () => {
    await runMemoryDedup();
  });

  await boss.schedule(QUEUE_NAME, SCHEDULE_CRON, {});
}
