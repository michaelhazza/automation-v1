import crypto from 'crypto';
import { eq, isNull, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentEmbeddings, systemAgents } from '../db/schema/index.js';
import type { AgentEmbedding } from '../db/schema/agentEmbeddings.js';
import { generateEmbedding, generateEmbeddings } from '../lib/embeddings.js';

// ---------------------------------------------------------------------------
// Agent Embedding Service
// ---------------------------------------------------------------------------
// Phase 2 of skill-analyzer-v2 (docs/skill-analyzer-v2-spec.md §10 Phase 2).
//
// Owns the content-addressed embedding cache for system agents. Used by:
//   - The Phase 2 Agent-embed pipeline stage in skillAnalyzerJob.ts (batch
//     refresh of every active system agent before the Agent-propose stage)
//   - The Phase 4 manual-add PATCH flow (single-agent refresh on demand
//     when a reviewer adds an agent that wasn't in the auto-suggested set)
//
// Lazy invalidation: an agent's embedding is recomputed only when its
// `contentHash` differs from the stored hash. There is NO eager invalidation
// from systemAgentService.updateAgent — that would couple two services for a
// path that only matters inside the analyzer pipeline. The architect's plan
// (§2.2) confirms this is intentional.
// ---------------------------------------------------------------------------

/** Compute the SHA-256 content hash for an agent's embed-eligible fields.
 *  Pure — exported so unit tests and the backfill script can use it without
 *  hitting the DB. The content string is the same shape used by Phase 2's
 *  Agent-embed stage; if you change it, every cached agent_embeddings row
 *  becomes stale and will be lazily recomputed on the next analyzer run. */
export function buildAgentContent(agent: {
  name: string;
  description: string | null;
  masterPrompt: string;
}): string {
  // Order matters — changing the order changes every hash. Keep it stable.
  return [agent.name, agent.description ?? '', agent.masterPrompt].join('\n');
}

/** Compute the SHA-256 hash of an agent's embed-eligible content. */
export function hashAgentContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Read the cached embedding for a system agent. Returns null if no row
 *  exists. Does NOT refresh staleness — call refreshSystemAgentEmbedding
 *  for that. */
export async function getAgentEmbedding(systemAgentId: string): Promise<AgentEmbedding | null> {
  const rows = await db
    .select()
    .from(agentEmbeddings)
    .where(eq(agentEmbeddings.systemAgentId, systemAgentId))
    .limit(1);
  return rows[0] ?? null;
}

/** Refresh exactly one agent's embedding if its stored contentHash differs
 *  from the live content hash, otherwise read-through. Returns the fresh
 *  agent_embeddings row. Throws if the agent does not exist or if the
 *  embedding generation fails (the manual-add flow needs to know
 *  immediately rather than serving up stale data). */
export async function refreshSystemAgentEmbedding(systemAgentId: string): Promise<AgentEmbedding> {
  const [agent] = await db
    .select()
    .from(systemAgents)
    .where(and(eq(systemAgents.id, systemAgentId), isNull(systemAgents.deletedAt)));

  if (!agent) {
    throw { statusCode: 404, message: `system agent ${systemAgentId} not found` };
  }

  const content = buildAgentContent({
    name: agent.name,
    description: agent.description,
    masterPrompt: agent.masterPrompt,
  });
  const contentHash = hashAgentContent(content);

  // Cache hit: stored row matches the live content hash.
  const existing = await getAgentEmbedding(systemAgentId);
  if (existing && existing.contentHash === contentHash) {
    return existing;
  }

  // Cache miss or stale row — generate a fresh embedding.
  const embedding = await generateEmbedding(content);
  if (!embedding) {
    throw {
      statusCode: 503,
      message: `failed to generate embedding for system agent ${systemAgentId} — OPENAI_API_KEY missing or upstream error`,
    };
  }

  // Upsert. The PK is systemAgentId so onConflictDoUpdate is straightforward.
  const [row] = await db
    .insert(agentEmbeddings)
    .values({
      systemAgentId,
      contentHash,
      embedding,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: agentEmbeddings.systemAgentId,
      set: {
        contentHash,
        embedding,
        updatedAt: new Date(),
      },
    })
    .returning();

  return row;
}

/** Refresh embeddings for every active (non-deleted) system agent in batch.
 *  Used by the Phase 2 Agent-embed pipeline stage at the start of every
 *  analyzer run. Skips agents whose stored hash already matches (cache
 *  hit), batches the OpenAI embedding calls for the rest. No-op when there
 *  are zero system agents. */
export async function refreshSystemAgentEmbeddings(): Promise<void> {
  const agents = await db
    .select()
    .from(systemAgents)
    .where(isNull(systemAgents.deletedAt));

  if (agents.length === 0) return;

  // Build the content + hash for every agent up front.
  type AgentToProcess = {
    systemAgentId: string;
    content: string;
    contentHash: string;
  };
  const allAgents: AgentToProcess[] = agents.map((a) => {
    const content = buildAgentContent({
      name: a.name,
      description: a.description,
      masterPrompt: a.masterPrompt,
    });
    return {
      systemAgentId: a.id,
      content,
      contentHash: hashAgentContent(content),
    };
  });

  // Read every existing cached row in one query and diff against the live
  // hashes. Anything whose hash matches is a cache hit and skipped.
  const existing = await db
    .select({
      systemAgentId: agentEmbeddings.systemAgentId,
      contentHash: agentEmbeddings.contentHash,
    })
    .from(agentEmbeddings);
  const existingByAgentId = new Map(existing.map((r) => [r.systemAgentId, r.contentHash]));

  const stale = allAgents.filter(
    (a) => existingByAgentId.get(a.systemAgentId) !== a.contentHash,
  );

  if (stale.length === 0) {
    return;
  }

  // Batch the OpenAI call. generateEmbeddings handles batching above the
  // OpenAI limit; we hand it one big array and accept whatever it returns.
  const texts = stale.map((s) => s.content);
  const embeddings = await generateEmbeddings(texts);
  if (!embeddings) {
    // OPENAI_API_KEY missing or upstream error. The pipeline tolerates this:
    // the Agent-propose stage will see no embeddings and emit empty
    // agentProposals on every result, matching the §6.2 zero-agents edge case.
    return;
  }

  // Upsert every refreshed row in a single multi-row insert.
  const now = new Date();
  const rows = stale.map((s, i) => ({
    systemAgentId: s.systemAgentId,
    contentHash: s.contentHash,
    embedding: embeddings[i],
    updatedAt: now,
  }));

  // Drizzle batch upsert: reference excluded.* on the SET clause so each
  // row's incoming values are used (not a single static value).
  await db
    .insert(agentEmbeddings)
    .values(rows)
    .onConflictDoUpdate({
      target: agentEmbeddings.systemAgentId,
      set: {
        contentHash: sql`excluded.content_hash`,
        embedding: sql`excluded.embedding`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

export const agentEmbeddingService = {
  buildAgentContent,
  hashAgentContent,
  getAgentEmbedding,
  refreshSystemAgentEmbedding,
  refreshSystemAgentEmbeddings,
};
