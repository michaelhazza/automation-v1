import { pgTable, uuid, text, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';

// ---------------------------------------------------------------------------
// Canonical Row Subaccount Scopes — junction table that maps individual
// canonical rows to one or more subaccounts, supporting multi-tenant
// visibility (primary owner, mentioned, shared).
// ---------------------------------------------------------------------------

export const canonicalRowSubaccountScopes = pgTable(
  'canonical_row_subaccount_scopes',
  {
    canonicalTable: text('canonical_table').notNull(),
    canonicalRowId: uuid('canonical_row_id').notNull(),
    subaccountId: uuid('subaccount_id').notNull(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    attribution: text('attribution').notNull().$type<'primary' | 'mentioned' | 'shared'>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.canonicalTable, table.canonicalRowId, table.subaccountId] }),
    subIdx: index('canonical_row_subaccount_scopes_sub_idx').on(table.subaccountId, table.canonicalTable),
    orgIdx: index('canonical_row_subaccount_scopes_org_idx').on(table.organisationId),
  })
);

export type CanonicalRowSubaccountScope = typeof canonicalRowSubaccountScopes.$inferSelect;
export type NewCanonicalRowSubaccountScope = typeof canonicalRowSubaccountScopes.$inferInsert;
