import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import type { Transaction } from '../db/index.js';
import { memoryBlockVersionSources, agentRuns, agents } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LineageEntry {
  id: string;
  content: string;
  qualityScore: number;
  agentRunId: string | null;
}

export interface WriteLineageParams {
  tx: Transaction;
  blockVersionId: string;
  organisationId: string;
  cluster: LineageEntry[];
  avgQuality: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sha256hex(str: string): string {
  return createHash('sha256').update(str).digest('hex');
}

function formatRunLabel(agentName: string, createdAt: Date): string {
  const d = createdAt;
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hour = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${agentName} · ${year}-${month}-${day} ${hour}:${min}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write one memory_block_version_sources row per cluster entry in the same
 * transaction as the memory_blocks + memory_block_versions inserts.
 *
 * On conflict (block_version_id, source_entry_id_hash) the row is silently
 * skipped (idempotent per spec §13.1).
 *
 * Agent-name label resolution rules (spec §4 Phase 1 / R2):
 *  - entry.agentRunId !== null and JOIN returns a row → label populated
 *  - entry.agentRunId !== null but JOIN returns 0 rows (run hard-deleted) →
 *    source_run_id + hash written; label null; log synthesis.run_label_unresolved
 *  - entry.agentRunId === null → all three run fields null (never inferred)
 *  - JOIN query error → propagates; surrounding tx rolls back
 */
export async function writeLineageRowsForVersion(
  params: WriteLineageParams,
): Promise<{ rowsWritten: number }> {
  const { tx, blockVersionId, organisationId, cluster, avgQuality } = params;

  let rowsWritten = 0;

  for (let i = 0; i < cluster.length; i++) {
    const entry = cluster[i];
    const sourceEntryIdHash = sha256hex(entry.id);
    const contentHash = sha256hex(entry.content);

    let sourceRunId: string | null = null;
    let sourceRunIdHash: string | null = null;
    let sourceRunLabelAtCapture: string | null = null;

    if (entry.agentRunId !== null) {
      sourceRunId = entry.agentRunId;
      sourceRunIdHash = sha256hex(entry.agentRunId);

      // No try/catch: query errors propagate so the tx rolls back cleanly.
      // An empty result is NOT an error — the run was hard-deleted; label stays null.
      const [runRow] = await tx
        .select({ agentName: agents.name, runCreatedAt: agentRuns.createdAt })
        .from(agentRuns)
        .innerJoin(agents, eq(agentRuns.agentId, agents.id))
        .where(eq(agentRuns.id, entry.agentRunId));

      if (runRow) {
        sourceRunLabelAtCapture = formatRunLabel(runRow.agentName, runRow.runCreatedAt);
      } else {
        logger.info('synthesis.run_label_unresolved', {
          agentRunId: entry.agentRunId,
          entryId: entry.id,
        });
      }
    }

    await tx
      .insert(memoryBlockVersionSources)
      .values({
        organisationId,
        blockVersionId,
        sourceEntryId: entry.id,
        sourceEntryIdHash,
        contentHash,
        sourceType: 'workspace_memory',
        qualityScoreAtCapture: entry.qualityScore != null
          ? String(entry.qualityScore)
          : String(avgQuality),
        contributionRank: i + 1,
        sourceRunId,
        sourceRunIdHash,
        sourceRunLabelAtCapture,
      })
      .onConflictDoNothing();

    rowsWritten += 1;
  }

  return { rowsWritten };
}
