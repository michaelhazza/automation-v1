import { pgTable, uuid, text, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { workspaceIdentities } from './workspaceIdentities';
import { workspaceActors } from './workspaceActors';
import { auditEvents } from './auditEvents';

// Partial unique indexes (workspace_messages_external_uniq, workspace_messages_dedupe_uniq)
// live in SQL — Drizzle index DSL does not express partial indexes.
export const workspaceMessages = pgTable(
  'workspace_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    identityId: uuid('identity_id').notNull().references(() => workspaceIdentities.id),
    actorId: uuid('actor_id').notNull().references(() => workspaceActors.id),
    threadId: uuid('thread_id').notNull(),
    externalMessageId: text('external_message_id'),
    direction: text('direction').notNull(), // 'inbound' | 'outbound' — CHECK enforced in SQL
    fromAddress: text('from_address').notNull(),
    toAddresses: text('to_addresses').array().notNull().default(sql`'{}'`),
    ccAddresses: text('cc_addresses').array().default(sql`'{}'`),
    subject: text('subject'),
    bodyText: text('body_text'),
    bodyHtml: text('body_html'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    auditEventId: uuid('audit_event_id').references(() => auditEvents.id),
    rateLimitDecision: text('rate_limit_decision').notNull().default('allowed'),
    attachmentsCount: integer('attachments_count').notNull().default(0),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('workspace_messages_org_idx').on(table.organisationId),
    subaccountIdx: index('workspace_messages_subaccount_idx').on(table.subaccountId),
    identityIdx: index('workspace_messages_identity_idx').on(table.identityId),
    actorIdx: index('workspace_messages_actor_idx').on(table.actorId),
    threadIdx: index('workspace_messages_thread_idx').on(table.threadId),
  })
);

export type WorkspaceMessage = typeof workspaceMessages.$inferSelect;
export type NewWorkspaceMessage = typeof workspaceMessages.$inferInsert;
