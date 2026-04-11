import {
  pgTable,
  uuid,
  text,
  timestamp,
  customType,
} from 'drizzle-orm/pg-core';
import { systemAgents } from './systemAgents';

// pgvector custom type — mirrors skillEmbeddings.ts to preserve a single
// convention for embedding storage in this codebase.
const vector = customType<{ data: number[] }>({
  dataType() { return 'vector(1536)'; },
  toDriver(val: number[]): string {
    return `[${val.join(',')}]`;
  },
  fromDriver(val: unknown): number[] {
    if (typeof val === 'string') {
      return val.replace(/^\[|\]$/g, '').split(',').map(Number);
    }
    return [];
  },
});

// ---------------------------------------------------------------------------
// Agent Embeddings — content-addressed embedding cache for system agents
//
// Mirrors skill_embeddings but keyed by systemAgentId instead of contentHash
// because each system agent has exactly one current embedding (no aliasing
// across content). The contentHash column is the cache invalidator: when
// the agent's name/description/masterPrompt change, the hash changes, and
// the Phase 2 Agent-embed pipeline stage recomputes the embedding lazily.
//
// Used by the Phase 2 agent-propose pipeline stage and by the Phase 4
// manual-add PATCH flow (refreshSystemAgentEmbedding). See spec §5.1.
// ---------------------------------------------------------------------------

export const agentEmbeddings = pgTable(
  'agent_embeddings',
  {
    systemAgentId: uuid('system_agent_id')
      .primaryKey()
      .references(() => systemAgents.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash').notNull(),
    embedding: vector('embedding').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

export type AgentEmbedding = typeof agentEmbeddings.$inferSelect;
export type NewAgentEmbedding = typeof agentEmbeddings.$inferInsert;
