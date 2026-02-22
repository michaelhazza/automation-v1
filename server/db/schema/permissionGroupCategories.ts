import { pgTable, uuid, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { permissionGroups } from './permissionGroups';
import { taskCategories } from './taskCategories';

export const permissionGroupCategories = pgTable(
  'permission_group_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    permissionGroupId: uuid('permission_group_id')
      .notNull()
      .references(() => permissionGroups.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => taskCategories.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    groupCategoryUniqueIdx: uniqueIndex('pgc_group_category_unique_idx').on(table.permissionGroupId, table.categoryId),
    groupIdx: index('pgc_group_idx').on(table.permissionGroupId),
    categoryIdx: index('pgc_category_idx').on(table.categoryId),
  })
);

export type PermissionGroupCategory = typeof permissionGroupCategories.$inferSelect;
export type NewPermissionGroupCategory = typeof permissionGroupCategories.$inferInsert;
