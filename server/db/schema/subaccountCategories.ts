import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { subaccounts } from './subaccounts';

export const subaccountCategories = pgTable(
  'subaccount_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    name: text('name').notNull(),
    description: text('description'),
    colour: text('colour'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    subaccountIdx: index('subaccount_categories_subaccount_idx').on(table.subaccountId),
    // M-7: unique name per subaccount, soft-delete-aware
    subaccountNameUniq: uniqueIndex('subaccount_categories_name_unique_idx')
      .on(table.subaccountId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

export type SubaccountCategory = typeof subaccountCategories.$inferSelect;
export type NewSubaccountCategory = typeof subaccountCategories.$inferInsert;
