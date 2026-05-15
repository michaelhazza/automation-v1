import { and, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { workspaceMemoryEntries } from '../../db/schema/index.js';
import { routeCall } from '../llmRouter.js';
import { generateEmbedding, formatVectorLiteral } from '../../lib/embeddings.js';
import {
  EXTRACTION_MAX_TOKENS,
  MAX_EMBEDDING_INPUT_CHARS,
} from '../../config/limits.js';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// pgBoss callback — module-level state owned here (W4).
// setContextEnrichmentJobSender is the public setter.
// extract.ts reads pgBossSendCallback via getPgBossSendCallback().
// ---------------------------------------------------------------------------

let pgBossSendCallback: ((queue: string, data: unknown, options?: Record<string, unknown>) => Promise<void>) | null = null;

export function setContextEnrichmentJobSender(
  fn: ((queue: string, data: unknown, options?: Record<string, unknown>) => Promise<void>) | null,
): void {
  pgBossSendCallback = fn;
}

export function getPgBossSendCallback(): typeof pgBossSendCallback {
  return pgBossSendCallback;
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
