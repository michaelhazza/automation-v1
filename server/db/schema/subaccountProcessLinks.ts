import { pgTable, uuid, text, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { subaccounts } from './subaccounts';
import { processes } from './processes';
import { subaccountCategories } from './subaccountCategories';

export const subaccountProcessLinks = pgTable(
  'subaccount_process_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    processId: uuid('process_id')
      .notNull()
      .references(() => processes.id),
    subaccountCategoryId: uuid('subaccount_category_id')
      .references(() => subaccountCategories.id),
    isActive: boolean('is_active').notNull().default(true),
    // Per-subaccount config overrides (merged with process.default_config at execution time)
    configOverrides: jsonb('config_overrides'),
    // Override input schema for this subaccount (rare, for advanced customisation)
    customInputSchema: text('custom_input_schema'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    subaccountProcessUniqueIdx: uniqueIndex('subaccount_process_links_subaccount_process_unique_idx').on(
      table.subaccountId,
      table.processId
    ),
    subaccountIdx: index('subaccount_process_links_subaccount_idx').on(table.subaccountId),
    processIdx: index('subaccount_process_links_process_idx').on(table.processId),
    categoryIdx: index('subaccount_process_links_category_idx').on(table.subaccountCategoryId),
  })
);

export type SubaccountProcessLink = typeof subaccountProcessLinks.$inferSelect;
export type NewSubaccountProcessLink = typeof subaccountProcessLinks.$inferInsert;
