import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
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
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    subaccountIdx: index('subaccount_categories_subaccount_idx').on(table.subaccountId),
    subaccountNameIdx: index('subaccount_categories_subaccount_name_idx').on(table.subaccountId, table.name),
  })
);

export type SubaccountCategory = typeof subaccountCategories.$inferSelect;
export type NewSubaccountCategory = typeof subaccountCategories.$inferInsert;
