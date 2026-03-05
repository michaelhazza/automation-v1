import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { organisations } from './organisations';
import { users } from './users';

export const agentConversations = pgTable(
  'agent_conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    // Auto-generated from first user message
    title: text('title'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    agentIdx: index('agent_conversations_agent_idx').on(table.agentId),
    userIdx: index('agent_conversations_user_idx').on(table.userId),
    orgUserIdx: index('agent_conversations_org_user_idx').on(table.organisationId, table.userId),
    agentUserIdx: index('agent_conversations_agent_user_idx').on(table.agentId, table.userId),
  })
);

export type AgentConversation = typeof agentConversations.$inferSelect;
export type NewAgentConversation = typeof agentConversations.$inferInsert;
