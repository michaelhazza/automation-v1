import { pgTable, uuid, text, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';

export const subaccounts = pgTable(
  'subaccounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: text('status').notNull().default('active').$type<'active' | 'suspended' | 'inactive'>(),
    settings: jsonb('settings'),

    // ── Org-level inbox visibility ────────────────────────────────────
    // When true, inbox items from this subaccount appear in the org-wide inbox.
    // Configurable per subaccount by org admins.
    includeInOrgInbox: boolean('include_in_org_inbox').notNull().default(true),

    // ── Org subaccount flag ──────────────────────────────────────────
    // When true, this subaccount is the organisation's own workspace.
    // One per org (enforced by partial unique index). Cannot be soft-deleted
    // or have status changed away from 'active' (enforced by DB CHECK constraints).
    isOrgSubaccount: boolean('is_org_subaccount').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index('subaccounts_org_idx').on(table.organisationId),
    orgStatusIdx: index('subaccounts_org_status_idx').on(table.organisationId, table.status),
    slugUniqueIdx: uniqueIndex('subaccounts_slug_unique_idx')
      .on(table.organisationId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

export type Subaccount = typeof subaccounts.$inferSelect;
export type NewSubaccount = typeof subaccounts.$inferInsert;
