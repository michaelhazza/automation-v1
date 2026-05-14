import { pgTable, uuid, text, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { agentConversations } from './agentConversations';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import type { ThreadContextDecision, ThreadContextTask } from '../../../shared/types/conversationThreadContext.js';

export const conversationThreadContext = pgTable(
  'conversation_thread_context',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id').notNull().unique().references(() => agentConversations.id, { onDelete: 'cascade' }),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    decisions: jsonb('decisions').$type<ThreadContextDecision[]>().notNull().default([]),
    tasks: jsonb('tasks').$type<ThreadContextTask[]>().notNull().default([]),
    approach: text('approach').notNull().default(''),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('conv_thread_ctx_org_idx').on(table.organisationId),
    conversationUniq: uniqueIndex('conv_thread_ctx_conv_uniq').on(table.conversationId),
  })
);

export type ConversationThreadContext = typeof conversationThreadContext.$inferSelect;
export type NewConversationThreadContext = typeof conversationThreadContext.$inferInsert;
