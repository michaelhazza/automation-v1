import { pgTable, uuid, text, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { canonicalAccounts } from './canonicalAccounts.js';

// ---------------------------------------------------------------------------
// Account Overrides — per-account temporary suppressions
// ---------------------------------------------------------------------------

export const accountOverrides = pgTable(
  'account_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    accountId: uuid('account_id').notNull().references(() => canonicalAccounts.id, { onDelete: 'cascade' }),
    suppressScoring: boolean('suppress_scoring').notNull().default(false),
    suppressAlerts: boolean('suppress_alerts').notNull().default(false),
    reason: text('reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgAccountUnique: uniqueIndex('account_overrides_org_account_unique').on(table.organisationId, table.accountId),
    expiryIdx: index('account_overrides_expiry_idx').on(table.expiresAt),
  })
);

export type AccountOverride = typeof accountOverrides.$inferSelect;
export type NewAccountOverride = typeof accountOverrides.$inferInsert;
