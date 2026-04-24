import { pgTable, uuid, text, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { subaccounts } from './subaccounts';
import { automations } from './automations';
import { subaccountCategories } from './subaccountCategories';

export const subaccountAutomationLinks = pgTable(
  'subaccount_automation_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    processId: uuid('process_id')
      .notNull()
      .references(() => automations.id),
    subaccountCategoryId: uuid('subaccount_category_id')
      .references(() => subaccountCategories.id),
    isActive: boolean('is_active').notNull().default(true),
    // Per-subaccount config overrides (merged with automation.default_config at execution time)
    configOverrides: jsonb('config_overrides'),
    // Override input schema for this subaccount (rare, for advanced customisation)
    customInputSchema: text('custom_input_schema'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    subaccountAutomationUniqueIdx: uniqueIndex('subaccount_automation_links_subaccount_automation_unique_idx').on(
      table.subaccountId,
      table.processId
    ),
    subaccountIdx: index('subaccount_automation_links_subaccount_idx').on(table.subaccountId),
    automationIdx: index('subaccount_automation_links_automation_idx').on(table.processId),
    categoryIdx: index('subaccount_automation_links_category_idx').on(table.subaccountCategoryId),
  })
);

export type SubaccountAutomationLink = typeof subaccountAutomationLinks.$inferSelect;
export type NewSubaccountAutomationLink = typeof subaccountAutomationLinks.$inferInsert;
