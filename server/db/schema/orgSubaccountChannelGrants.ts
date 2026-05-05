import { pgTable, uuid, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { orgApprovalChannels } from './orgApprovalChannels';

// ---------------------------------------------------------------------------
// org_subaccount_channel_grants — bridge for org-channel → sub-account fan-out
//
// Org admin grants an org-owned channel to receive approvals from a specific
// sub-account. Deactivate on revoke; never delete (audit trail).
// Spec: tasks/builds/agentic-commerce/spec.md §5.1
// Migration: 0271_agentic_commerce_schema.sql
// ---------------------------------------------------------------------------

export const orgSubaccountChannelGrants = pgTable(
  'org_subaccount_channel_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    // Target sub-account that the org channel now covers.
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    orgChannelId: uuid('org_channel_id')
      .notNull()
      .references(() => orgApprovalChannels.id),
    // The user who granted the channel access.
    grantedByUserId: uuid('granted_by_user_id').notNull(),
    // Deactivate on revoke; never delete.
    active: boolean('active').notNull().default(true),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('org_subaccount_channel_grants_org_idx').on(table.organisationId),
    subaccountIdx: index('org_subaccount_channel_grants_subaccount_idx')
      .on(table.subaccountId, table.organisationId),
    channelIdx: index('org_subaccount_channel_grants_channel_idx').on(table.orgChannelId),
    // Partial UNIQUE — at most one active grant per (orgChannelId, subaccountId)
    // pair. Revoked rows are preserved (audit trail) and not blocked by the
    // constraint. Migration: 0275_grants_active_unique.sql.
    activeUnique: uniqueIndex('org_subaccount_channel_grants_active_unique')
      .on(table.orgChannelId, table.subaccountId)
      .where(sql`${table.active} = TRUE`),
  }),
);

export type OrgSubaccountChannelGrant = typeof orgSubaccountChannelGrants.$inferSelect;
export type NewOrgSubaccountChannelGrant = typeof orgSubaccountChannelGrants.$inferInsert;
