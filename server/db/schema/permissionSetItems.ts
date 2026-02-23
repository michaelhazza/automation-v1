import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { permissionSets } from './permissionSets';
import { permissions } from './permissions';

export const permissionSetItems = pgTable(
  'permission_set_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    permissionSetId: uuid('permission_set_id')
      .notNull()
      .references(() => permissionSets.id),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    setKeyUniqueIdx: uniqueIndex('permission_set_items_set_key_unique_idx').on(
      table.permissionSetId,
      table.permissionKey
    ),
    setIdx: index('permission_set_items_set_idx').on(table.permissionSetId),
    keyIdx: index('permission_set_items_key_idx').on(table.permissionKey),
  })
);

export type PermissionSetItem = typeof permissionSetItems.$inferSelect;
export type NewPermissionSetItem = typeof permissionSetItems.$inferInsert;
