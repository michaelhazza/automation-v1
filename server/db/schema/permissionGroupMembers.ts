import { pgTable, uuid, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { permissionGroups } from './permissionGroups';
import { users } from './users';

export const permissionGroupMembers = pgTable(
  'permission_group_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    permissionGroupId: uuid('permission_group_id')
      .notNull()
      .references(() => permissionGroups.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    groupUserUniqueIdx: uniqueIndex('pgm_group_user_unique_idx').on(table.permissionGroupId, table.userId),
    groupIdx: index('pgm_group_idx').on(table.permissionGroupId),
    userIdx: index('pgm_user_idx').on(table.userId),
  })
);

export type PermissionGroupMember = typeof permissionGroupMembers.$inferSelect;
export type NewPermissionGroupMember = typeof permissionGroupMembers.$inferInsert;
