import { pgTable, uuid, text, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const agentDataSources = pgTable(
  'agent_data_sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    // Where to fetch data from
    sourceType: text('source_type').notNull().$type<'r2' | 's3' | 'http_url'>(),
    // For r2/s3: the object key/path. For http_url: the full URL
    sourcePath: text('source_path').notNull(),
    // Optional HTTP headers (e.g. auth) for http_url sources
    sourceHeaders: jsonb('source_headers').$type<Record<string, string>>(),
    // How to parse the fetched content
    contentType: text('content_type').notNull().default('auto').$type<'json' | 'csv' | 'markdown' | 'text' | 'auto'>(),
    // Priority order (lower number = included first in context)
    priority: integer('priority').notNull().default(0),
    // Max tokens this source can contribute to context (approx 4 chars per token)
    maxTokenBudget: integer('max_token_budget').notNull().default(8000),
    // Cache control
    cacheMinutes: integer('cache_minutes').notNull().default(60),
    lastFetchedAt: timestamp('last_fetched_at'),
    lastFetchStatus: text('last_fetch_status').$type<'ok' | 'error' | 'pending'>(),
    lastFetchError: text('last_fetch_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    agentIdx: index('agent_data_sources_agent_idx').on(table.agentId),
    agentPriorityIdx: index('agent_data_sources_agent_priority_idx').on(table.agentId, table.priority),
  })
);

export type AgentDataSource = typeof agentDataSources.$inferSelect;
export type NewAgentDataSource = typeof agentDataSources.$inferInsert;
