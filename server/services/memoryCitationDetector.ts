/**
 * memoryCitationDetector — S12 citation detection (run-completion hook)
 *
 * After an agent run completes, scores each injected memory entry against the
 * run's generated text + tool call arguments and writes:
 *   - one `memory_citation_scores` row per entry
 *   - the set of cited entry IDs to `agent_runs.cited_entry_ids`
 *   - `injected_count` += 1 for every injected entry
 *   - `cited_count` += 1 for every cited entry
 *
 * **qualityScore mutation invariant (§4.4):** This service NEVER touches
 * `qualityScore`. Only `memoryEntryQualityService.applyDecay()` and the
 * weekly `adjustFromUtility()` are allowed to mutate qualityScore.
 *
 * **Idempotency:** `scoreRun(runId)` is idempotent via the
 * `memory_citation_scores` primary key (run_id, entry_id). A second call
 * for the same run is a no-op — upsert with `onConflictDoNothing`.
 *
 * Spec: docs/memory-and-briefings-spec.md §4.4 (S12)
 */

import { eq, and, sql, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  agentRuns,
  memoryCitationScores,
  memoryBlocks,
  workspaceMemoryEntries,
} from '../db/schema/index.js';
import {
  CITATION_THRESHOLD,
  CITATION_TEXT_OVERLAP_MIN,
  CITATION_TEXT_TOKEN_MIN,
} from '../config/limits.js';
import {
  computeToolCallScore,
  computeTextMatch,
  computeFinalCitation,
} from './memoryCitationDetectorPure.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScoreRunParams {
  runId: string;
  organisationId: string;
  /** Entries that were injected into the run's context. */
  injectedEntries: Array<{
    id: string;
    content: string;
    /** Optional key phrases to match against tool-call args. */
    keyPhrases?: string[];
  }>;
  /** The agent's generated text output for the run (concatenated if multi-message). */
  generatedText: string;
  /** Tool call arguments from the run, in invocation order. */
  toolCallArgs: unknown[];
}

export interface ScoreRunResult {
  /** IDs of entries that passed the citation threshold. */
  citedEntryIds: string[];
  /** IDs of every entry that was scored (== injectedEntries.length). */
  scoredEntryIds: string[];
  /** Whether the scoring run was a no-op (already scored). */
  alreadyScored: boolean;
}

/**
 * Score every injected entry against the run output and persist results.
 *
 * Safe to call twice for the same run — the second call is a no-op for the
 * scores table (PK conflict) and skips counter bumps to preserve S4 invariants.
 */
export async function scoreRun(params: ScoreRunParams): Promise<ScoreRunResult> {
  if (params.injectedEntries.length === 0) {
    return { citedEntryIds: [], scoredEntryIds: [], alreadyScored: false };
  }

  // Idempotency check — skip if any score exists for this run.
  const [existing] = await db
    .select({ runId: memoryCitationScores.runId })
    .from(memoryCitationScores)
    .where(eq(memoryCitationScores.runId, params.runId))
    .limit(1);

  if (existing) {
    logger.debug('memoryCitationDetector.alreadyScored', { runId: params.runId });
    return {
      citedEntryIds: [],
      scoredEntryIds: params.injectedEntries.map((e) => e.id),
      alreadyScored: true,
    };
  }

  // Score each entry
  const scoreRows: Array<typeof memoryCitationScores.$inferInsert> = [];
  const citedEntryIds: string[] = [];
  const scoredEntryIds: string[] = [];

  for (const entry of params.injectedEntries) {
    const keyPhrases = entry.keyPhrases && entry.keyPhrases.length > 0
      ? entry.keyPhrases
      : [entry.content.slice(0, 200)]; // fallback: first 200 chars

    const toolCallScore = computeToolCallScore(keyPhrases, params.toolCallArgs);
    const textMatch = computeTextMatch({
      entryContent: entry.content,
      generatedText: params.generatedText,
      overlapMin: CITATION_TEXT_OVERLAP_MIN,
      tokenMin: CITATION_TEXT_TOKEN_MIN,
    });
    const final = computeFinalCitation({
      toolCallScore,
      textMatch,
      threshold: CITATION_THRESHOLD,
    });

    scoreRows.push({
      runId: params.runId,
      entryId: entry.id,
      toolCallScore: final.toolCallScore,
      textScore: final.textScore,
      finalScore: final.finalScore,
      cited: final.cited,
    });
    scoredEntryIds.push(entry.id);
    if (final.cited) citedEntryIds.push(entry.id);
  }

  // Persist atomically
  await db.transaction(async (tx) => {
    // 1. Insert score rows (PK conflict = idempotent no-op)
    await tx
      .insert(memoryCitationScores)
      .values(scoreRows)
      .onConflictDoNothing({ target: [memoryCitationScores.runId, memoryCitationScores.entryId] });

    // 2. Bump injected_count for all scored entries
    if (scoredEntryIds.length > 0) {
      await tx
        .update(workspaceMemoryEntries)
        .set({ injectedCount: sql`${workspaceMemoryEntries.injectedCount} + 1` })
        .where(inArray(workspaceMemoryEntries.id, scoredEntryIds));
    }

    // 3. Bump cited_count for cited entries
    if (citedEntryIds.length > 0) {
      await tx
        .update(workspaceMemoryEntries)
        .set({ citedCount: sql`${workspaceMemoryEntries.citedCount} + 1` })
        .where(inArray(workspaceMemoryEntries.id, citedEntryIds));
    }

    // 4. Record cited IDs on the agent_runs row
    await tx
      .update(agentRuns)
      .set({ citedEntryIds })
      .where(
        and(
          eq(agentRuns.id, params.runId),
          eq(agentRuns.organisationId, params.organisationId),
        ),
      );
  });

  logger.info('memoryCitationDetector.scored', {
    runId: params.runId,
    injected: scoredEntryIds.length,
    cited: citedEntryIds.length,
  });

  return { citedEntryIds, scoredEntryIds, alreadyScored: false };
}

// ---------------------------------------------------------------------------
// Phase 8 / W3c — memory_block citation scoring (extends scoreRun pattern)
// ---------------------------------------------------------------------------

export interface ScoreBlocksParams {
  runId: string;
  organisationId: string;
  /** Block IDs from agent_runs.applied_memory_block_ids */
  appliedBlockIds: string[];
  /** The agent's generated text output for the run. */
  runOutputText: string;
  config?: { minCitationScore: number };
}

/**
 * Scores applied memory blocks against run output and writes citations
 * to agent_runs.applied_memory_block_citations. Best-effort — never throws.
 */
export async function scoreRunBlocks(params: ScoreBlocksParams): Promise<void> {
  if (params.appliedBlockIds.length === 0) return;

  try {
    const { detectBlockCitationsPure } = await import('./memoryBlockCitationDetectorPure.js');
    const blocks = await db
      .select({ id: memoryBlocks.id, text: sql<string>`${memoryBlocks.content}` })
      .from(memoryBlocks)
      .where(inArray(memoryBlocks.id, params.appliedBlockIds));

    const citations = detectBlockCitationsPure({
      appliedBlockIds: params.appliedBlockIds,
      blocks,
      runOutputText: params.runOutputText,
      config: params.config ?? { minCitationScore: 0.6 },
    });

    if (citations.length > 0) {
      await db
        .update(agentRuns)
        .set({ appliedMemoryBlockCitations: citations })
        .where(
          and(
            eq(agentRuns.id, params.runId),
            eq(agentRuns.organisationId, params.organisationId),
          ),
        );
    }
  } catch (err) {
    logger.warn({ err, runId: params.runId }, 'scoreRunBlocks: failed, skipping');
  }
}
