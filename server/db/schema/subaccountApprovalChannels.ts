import { pgTable, uuid, text, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

// ---------------------------------------------------------------------------
// subaccount_approval_channels — per-sub-account HITL channel configuration
//
// Owned and managed by the sub-account admin. In v1 only 'in_app' is
// supported; slack/email/telegram/sms are deferred per spec §20.
// Spec: tasks/builds/agentic-commerce/spec.md §5.1
// Migration: 0271_agentic_commerce_schema.sql
// ---------------------------------------------------------------------------

export const subaccountApprovalChannels = pgTable(
  'subaccount_approval_channels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    // 'in_app' in v1; 'slack' | 'email' | 'telegram' deferred.
    channelType: text('channel_type').notNull(),
    // Channel-specific configuration payload.
    config: jsonb('config').notNull().default({}).$type<Record<string, unknown>>(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('subaccount_approval_channels_org_idx').on(table.organisationId),
    subaccountIdx: index('subaccount_approval_channels_subaccount_idx')
      .on(table.subaccountId, table.organisationId),
  }),
);

export type SubaccountApprovalChannel = typeof subaccountApprovalChannels.$inferSelect;
export type NewSubaccountApprovalChannel = typeof subaccountApprovalChannels.$inferInsert;
