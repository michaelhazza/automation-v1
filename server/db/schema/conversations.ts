import {
  pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * BOUNDARY: conversations are transport only.
 * Domain logic must not depend on conversation structure.
 * scopeType/scopeId are routing keys — not semantic domain identifiers.
 * Business rules belong in their respective domain services, not here.
 */
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull(),
  subaccountId: uuid('subaccount_id'),
  scopeType: text('scope_type', { enum: ['agent', 'brief', 'task', 'agent_run'] }).notNull(),
  scopeId: uuid('scope_id').notNull(),
  createdByUserId: uuid('created_by_user_id'),
  status: text('status', { enum: ['open', 'archived'] }).default('open').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  archivedAt: timestamp('archived_at'),
  metadata: jsonb('metadata').default({}).notNull(),
}, (table) => ({
  orgIdx: index('conversations_org_idx').on(table.organisationId),
  subaccountIdx: index('conversations_subaccount_idx').on(table.subaccountId),
  scopeIdx: index('conversations_scope_idx').on(table.scopeType, table.scopeId),
  uniqueScopePerEntity: uniqueIndex('conversations_unique_scope').on(table.organisationId, table.scopeType, table.scopeId),
}));

export const conversationMessages = pgTable('conversation_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  organisationId: uuid('organisation_id').notNull(),
  subaccountId: uuid('subaccount_id'),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  artefacts: jsonb('artefacts').default([]).notNull(),
  senderUserId: uuid('sender_user_id'),
  senderAgentId: uuid('sender_agent_id'),
  triggeredRunId: uuid('triggered_run_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  conversationIdx: index('conv_msgs_conversation_idx').on(table.conversationId),
  orgIdx: index('conv_msgs_org_idx').on(table.organisationId),
  subaccountIdx: index('conv_msgs_subaccount_idx').on(table.subaccountId),
  artefactsGinIdx: index('conv_msgs_artefacts_gin_idx').using('gin', table.artefacts),
}));

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type NewConversationMessage = typeof conversationMessages.$inferInsert;
