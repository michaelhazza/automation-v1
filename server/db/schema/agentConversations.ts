import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
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
    // M-8: subaccount isolation — set for all new conversations going forward
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    // Auto-generated from first user message
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    agentIdx: index('agent_conversations_agent_idx').on(table.agentId),
    userIdx: index('agent_conversations_user_idx').on(table.userId),
    orgUserIdx: index('agent_conversations_org_user_idx').on(table.organisationId, table.userId),
    agentUserIdx: index('agent_conversations_agent_user_idx').on(table.agentId, table.userId),
    subaccountIdx: index('agent_conversations_subaccount_idx').on(table.subaccountId),
  })
);

export type AgentConversation = typeof agentConversations.$inferSelect;
export type NewAgentConversation = typeof agentConversations.$inferInsert;
