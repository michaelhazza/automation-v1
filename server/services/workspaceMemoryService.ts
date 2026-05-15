import { eq, and, desc, inArray, sql, isNull, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  workspaceMemories,
  workspaceMemoryEntries,
} from '../db/schema/index.js';
import { routeCall } from './llmRouter.js';
import { taskService } from './taskService.js';
import { generateEmbedding, formatVectorLiteral } from '../lib/embeddings.js';
import {
  EXTRACTION_MAX_TOKENS,
  SUMMARY_MAX_TOKENS,
  MAX_EMBEDDING_INPUT_CHARS,
} from '../config/limits.js';
import { createHash } from 'crypto';
import {
  agentRoleToDomain,
  type ExtractRunInsightsOptions,
} from './workspaceMemoryService/types.js';
import * as readMethods from './workspaceMemoryService/read.js';
import { extractRunInsights, setExtractPgBossCallback } from './workspaceMemoryService/extract.js';
import * as retrieveMethods from './workspaceMemoryService/retrieve.js';
import * as entitiesMethods from './workspaceMemoryService/entities.js';

export type { ExtractRunInsightsOptions };
export { agentRoleToDomain };

// ---------------------------------------------------------------------------
// Workspace Memory Service — shared memory across agents in a workspace
// ---------------------------------------------------------------------------

export function setContextEnrichmentJobSender(fn: ((queue: string, data: unknown, options?: Record<string, unknown>) => Promise<void>) | null) {
  setExtractPgBossCallback(fn);
}

export const workspaceMemoryService = {
  // ─── Read ──────────────────────────────────────────────────────────────────
  ...readMethods,

  // ─── Post-Run Extraction ───────────────────────────────────────────────────
  extractRunInsights,

  // ─── Retrieve ──────────────────────────────────────────────────────────────
  ...retrieveMethods,

  // ─── Entities ──────────────────────────────────────────────────────────────
  ...entitiesMethods,

  // ─── Summary Regeneration (single LLM call for both memory + board) ───────

  async regenerateSummary(organisationId: string, subaccountId: string): Promise<void> {
    const memory = await readMethods.getOrCreateMemory(organisationId, subaccountId);

    // Load unincluded entries that meet the quality threshold
    const newEntries = await db
      .select()
      .from(workspaceMemoryEntries)
      .where(
        and(
          eq(workspaceMemoryEntries.subaccountId, subaccountId),
          eq(workspaceMemoryEntries.includedInSummary, false),
          // §7 G6.2 / migration 0126 — archived Reference notes must not
          // feed the summary compiler.
          isNull(workspaceMemoryEntries.deletedAt),
          sql`(${workspaceMemoryEntries.qualityScore} IS NULL OR ${workspaceMemoryEntries.qualityScore} >= ${memory.qualityThreshold})`
        )
      )
      .orderBy(desc(workspaceMemoryEntries.createdAt));

    if (newEntries.length === 0 && memory.summary) return;

    // Build board state snapshot (no LLM call — just raw data)
    const boardSnapshot = await buildBoardSnapshot(organisationId, subaccountId);

    // Build combined input for a single LLM call
    const parts: string[] = [];
    if (memory.summary) {
      parts.push(`## Current Memory Summary\n${memory.summary}`);
    }
    if (newEntries.length > 0) {
      parts.push('\n## New Insights to Incorporate');
      for (const entry of newEntries) {
        parts.push(`- [${entry.entryType}] ${entry.content}`);
      }
    }
    if (boardSnapshot) {
      parts.push(`\n## Current Board State\n${boardSnapshot}`);
    }

    const response = await routeCall({
      system: `You are a workspace memory compiler. Produce TWO sections separated by the exact marker "---BOARD_SUMMARY---".

SECTION 1 (before the marker): Updated workspace memory document.
Rules:
- Keep under 500 words
- Organise by theme (client preferences, ongoing issues, key decisions, patterns)
- Remove outdated or superseded information
- Prioritise actionable information
- Write in present tense, factual statements
- Do NOT include meta-commentary

SECTION 2 (after the marker): Board summary in under 200 words.
Focus on: what's in progress, what's blocked, what's completed recently, what needs attention.
If no board state is provided, write "No board data available."

Respond with ONLY the two sections separated by ---BOARD_SUMMARY---.`,
      messages: [{ role: 'user', content: parts.join('\n') }],
      temperature: 0.3,
      maxTokens: SUMMARY_MAX_TOKENS,
      context: {
        organisationId,
        subaccountId,
        sourceType: 'system',
        taskType: 'memory_compile',
        routingMode: 'ceiling',
      },
    });

    // Parse the two sections from the single response
    const separator = '---BOARD_SUMMARY---';
    const separatorIdx = response.content.indexOf(separator);
    let memorySummary: string;
    let boardSummary: string | null;

    if (separatorIdx >= 0) {
      memorySummary = response.content.slice(0, separatorIdx).trim();
      boardSummary = response.content.slice(separatorIdx + separator.length).trim() || null;
    } else {
      // Fallback: treat entire response as memory summary
      memorySummary = response.content.trim();
      boardSummary = null;
    }

    // Update memory record
    await db
      .update(workspaceMemories)
      .set({
        summary: memorySummary,
        boardSummary,
        runsSinceSummary: 0,
        version: memory.version + 1,
        summaryGeneratedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workspaceMemories.id, memory.id));

    // Mark entries as included (batch update)
    if (newEntries.length > 0) {
      await db
        .update(workspaceMemoryEntries)
        .set({ includedInSummary: true })
        .where(inArray(workspaceMemoryEntries.id, newEntries.map(e => e.id)));
    }
  },

};

// ---------------------------------------------------------------------------
// Build a compact board snapshot (pure data, no LLM call)
// ---------------------------------------------------------------------------

async function buildBoardSnapshot(organisationId: string, subaccountId: string): Promise<string | null> {
  const allTasks = await taskService.listTasks(organisationId, subaccountId, {});
  if (allTasks.length === 0) return null;

  const counts: Record<string, number> = {};
  const statusTasks: Record<string, string[]> = {};

  for (const t of allTasks) {
    const status = String(t.status);
    counts[status] = (counts[status] ?? 0) + 1;
    if (!statusTasks[status]) statusTasks[status] = [];
    if (statusTasks[status].length < 5) {
      statusTasks[status].push(
        `${t.title}${t.priority !== 'normal' ? ` [${t.priority}]` : ''}`
      );
    }
  }

  return Object.entries(statusTasks)
    .map(([status, titles]) => {
      const total = counts[status];
      const list = titles.map(t => `  - ${t}`).join('\n');
      return `**${status}** (${total}):\n${list}${total > 5 ? `\n  ... and ${total - 5} more` : ''}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Memory decay pruning (called by daily job)
// ---------------------------------------------------------------------------

export async function pruneStaleMemoryEntries(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90); // 90-day window

  const pruned = await db
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
    if (params.resetContext) {
      await db.execute(
        sql`UPDATE workspace_memory_entries
               SET embedding = ${formatVectorLiteral(embedding)}::vector,
                   embedding_computed_at = NOW(),
                   embedding_content_hash = ${contentHash},
                   embedding_context = NULL
             WHERE id = ${params.id}`
      );
    } else {
      await db.execute(
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
  const result = params.subaccountId
    ? await db.execute(sql`
        SELECT id, content
          FROM workspace_memory_entries
         WHERE embedding IS NOT NULL
           AND embedding_content_hash IS DISTINCT FROM content_hash
           AND deleted_at IS NULL
           AND subaccount_id = ${params.subaccountId}
         LIMIT ${limit}
      `)
    : await db.execute(sql`
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

// ---------------------------------------------------------------------------
// Context enrichment job handler (Phase B1)
// Called by the queue worker to generate context prefixes and re-embed
// ---------------------------------------------------------------------------

export async function processContextEnrichment(data: {
  entryIds: string[];
  runSummary: string;
  agentName: string;
  taskTitle: string | null;
  organisationId: string;
  subaccountId: string;
}) {
  const { entryIds, runSummary, agentName, taskTitle } = data;

  // Load entries that haven't been enriched yet (idempotency guard)
  const entries = await db
    .select({ id: workspaceMemoryEntries.id, content: workspaceMemoryEntries.content, embeddingContext: workspaceMemoryEntries.embeddingContext })
    .from(workspaceMemoryEntries)
    .where(and(
      inArray(workspaceMemoryEntries.id, entryIds),
      isNull(workspaceMemoryEntries.embeddingContext),
    ));

  if (entries.length === 0) return;

  // Generate contexts in a single LLM call
  const prompt = `You are generating short context prefixes for memory entries to improve search retrieval.

Agent: ${agentName}
Task: ${taskTitle ?? 'General'}
Run Summary: ${runSummary.slice(0, 2000)}

For each memory entry below, write a 1-2 sentence context that situates the entry within the broader context of this agent run. The context should help retrieval by mentioning the agent, task, domain, and any relevant keywords not in the entry itself.

Entries:
${entries.map((e, i) => `${i + 1}. ${e.content}`).join('\n')}

Respond with ONLY valid JSON: { "contexts": ["context for entry 1", "context for entry 2", ...] }`;

  try {
    const response = await routeCall({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      maxTokens: EXTRACTION_MAX_TOKENS,
      context: {
        organisationId: data.organisationId,
        subaccountId: data.subaccountId,
        sourceType: 'system',
        taskType: 'context_enrichment',
        routingMode: 'ceiling',
      },
    });

    const parsed = JSON.parse(response.content) as { contexts: string[] };
    if (!Array.isArray(parsed.contexts)) return;

    // Update each entry with context and re-embed
    for (let i = 0; i < entries.length && i < parsed.contexts.length; i++) {
      const entry = entries[i];
      const context = parsed.contexts[i];
      if (!context || entry.embeddingContext) continue; // skip if already enriched (race condition)

      // Snapshot the content hash we generated context for. If the row's
      // content has drifted between the SELECT above and this UPDATE (e.g. a
      // dedup re-embed ran in parallel), the CAS will no-op and the fresh
      // post-dedup embedding stays intact (review §2.1 race fix).
      const snapshotContentHash = createHash('md5').update(entry.content).digest('hex');

      const embeddingInput = `${context}\n\n${entry.content}`.slice(0, MAX_EMBEDDING_INPUT_CHARS);
      const embedding = await generateEmbedding(embeddingInput);

      // CAS guards:
      //   AND embedding_context IS NULL — another Phase 2 didn't already win
      //   AND content_hash = ${snapshotContentHash} — content hasn't drifted
      //                                               since we read it
      if (embedding) {
        await db.execute(
          sql`UPDATE workspace_memory_entries
              SET embedding_context = ${context},
                  embedding = ${formatVectorLiteral(embedding)}::vector,
                  embedding_computed_at = NOW(),
                  embedding_content_hash = ${snapshotContentHash}
              WHERE id = ${entry.id}
                AND embedding_context IS NULL
                AND content_hash = ${snapshotContentHash}`
        );
      }
    }

    console.info(`[WorkspaceMemory] Context enrichment complete: ${entries.length} entries processed`);
  } catch (err) {
    console.error('[WorkspaceMemory] Context enrichment failed:', err instanceof Error ? err.message : err);
    throw err; // Let pg-boss retry
  }
}
