import { pgTable, uuid, text, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { subaccountAgents } from './subaccountAgents';

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
    sourceType: text('source_type').notNull().$type<'r2' | 's3' | 'http_url' | 'google_docs' | 'dropbox' | 'file_upload'>(),
    // For r2/s3: the object key/path. For http_url/google_docs/dropbox: the full URL
    sourcePath: text('source_path').notNull(),
    // Optional HTTP headers (e.g. auth) for http_url sources; also used for google_docs API key
    sourceHeaders: jsonb('source_headers').$type<Record<string, string>>(),
    // How to parse the fetched content
    contentType: text('content_type').notNull().default('auto').$type<'json' | 'csv' | 'markdown' | 'text' | 'auto'>(),
    // Priority order (lower number = included first in context)
    priority: integer('priority').notNull().default(0),
    // Max tokens this source can contribute to context (approx 4 chars per token)
    maxTokenBudget: integer('max_token_budget').notNull().default(8000),
    // Refresh interval in minutes: for lazy = cache TTL; for proactive = polling interval
    cacheMinutes: integer('cache_minutes').notNull().default(60),
    // Sync mode: lazy = re-fetch on demand when cache expires; proactive = background polling
    syncMode: text('sync_mode').notNull().default('lazy').$type<'lazy' | 'proactive'>(),
    lastFetchedAt: timestamp('last_fetched_at'),
    lastFetchStatus: text('last_fetch_status').$type<'ok' | 'error' | 'pending'>(),
    lastFetchError: text('last_fetch_error'),
    // Timestamp of last admin alert email (used for 1-hour cooldown to avoid alert spam)
    lastAlertSentAt: timestamp('last_alert_sent_at'),
    // Subaccount-level data source: when set, this source is loaded only for this agent+subaccount combo.
    // When NULL, this is an org-level data source (original behaviour).
    subaccountAgentId: uuid('subaccount_agent_id')
      .references(() => subaccountAgents.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    agentIdx: index('agent_data_sources_agent_idx').on(table.agentId),
    agentPriorityIdx: index('agent_data_sources_agent_priority_idx').on(table.agentId, table.priority),
    subaccountAgentIdx: index('agent_data_sources_subaccount_agent_idx').on(table.subaccountAgentId),
  })
);

export type AgentDataSource = typeof agentDataSources.$inferSelect;
export type NewAgentDataSource = typeof agentDataSources.$inferInsert;
