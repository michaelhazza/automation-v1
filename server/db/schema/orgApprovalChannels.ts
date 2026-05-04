import { pgTable, uuid, text, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';

// ---------------------------------------------------------------------------
// org_approval_channels — org-owned HITL channel configuration
//
// Used for approvals on org-level agents and for granted sub-account fan-out
// via org_subaccount_channel_grants. In v1 only 'in_app' is supported.
// Spec: tasks/builds/agentic-commerce/spec.md §5.1
// Migration: 0271_agentic_commerce_schema.sql
// ---------------------------------------------------------------------------

export const orgApprovalChannels = pgTable(
  'org_approval_channels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    // 'in_app' in v1; other channel types deferred.
    channelType: text('channel_type').notNull(),
    // Channel-specific configuration payload.
    config: jsonb('config').notNull().default({}).$type<Record<string, unknown>>(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('org_approval_channels_org_idx').on(table.organisationId),
  }),
);

export type OrgApprovalChannel = typeof orgApprovalChannels.$inferSelect;
export type NewOrgApprovalChannel = typeof orgApprovalChannels.$inferInsert;
