import { pgTable, uuid, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { subaccounts } from './subaccounts';
import { tasks } from './tasks';
import { subaccountCategories } from './subaccountCategories';

export const subaccountTaskLinks = pgTable(
  'subaccount_task_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    subaccountCategoryId: uuid('subaccount_category_id')
      .references(() => subaccountCategories.id),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    subaccountTaskUniqueIdx: uniqueIndex('subaccount_task_links_subaccount_task_unique_idx').on(
      table.subaccountId,
      table.taskId
    ),
    subaccountIdx: index('subaccount_task_links_subaccount_idx').on(table.subaccountId),
    taskIdx: index('subaccount_task_links_task_idx').on(table.taskId),
    categoryIdx: index('subaccount_task_links_category_idx').on(table.subaccountCategoryId),
  })
);

export type SubaccountTaskLink = typeof subaccountTaskLinks.$inferSelect;
export type NewSubaccountTaskLink = typeof subaccountTaskLinks.$inferInsert;
