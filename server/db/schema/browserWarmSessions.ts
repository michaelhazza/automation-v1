import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

export const browserWarmSessions = pgTable(
  'browser_warm_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'restrict' }),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id, { onDelete: 'cascade' }),
    sandboxId: text('sandbox_id').notNull(),
    templateName: text('template_name').notNull(),
    templateVersion: text('template_version').notNull(),
    status: text('status').notNull().default('available')
      .$type<'available' | 'leased' | 'terminated'>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    leasedAt: timestamp('leased_at', { withTimezone: true }),
    terminatedAt: timestamp('terminated_at', { withTimezone: true }),
    idleCostCentsAttributed: integer('idle_cost_cents_attributed'),
  },
  (table) => ({
    subaccountStatusIdx: index('browser_warm_sessions_subaccount_status_idx').on(table.subaccountId, table.status),
    availableAgeIdx: index('browser_warm_sessions_available_age_idx').on(table.createdAt).where(sql`status = 'available'`),
    // R2-F5: DB-level "size 1 per enabled subaccount" invariant.
    // Two concurrent refill triggers cannot both create an 'available' warm session
    // for the same subaccount; the second INSERT hits 23505 and treats it as no-op.
    subaccountAvailableUniqueIdx: uniqueIndex('browser_warm_sessions_subaccount_available_unique_idx')
      .on(table.subaccountId).where(sql`status = 'available'`),
  }),
);

export type BrowserWarmSession = typeof browserWarmSessions.$inferSelect;
export type NewBrowserWarmSession = typeof browserWarmSessions.$inferInsert;
