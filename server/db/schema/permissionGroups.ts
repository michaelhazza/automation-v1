import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';

export const permissionGroups = pgTable(
  'permission_groups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    orgIdx: index('permission_groups_org_idx').on(table.organisationId),
    orgNameIdx: index('permission_groups_org_name_idx').on(table.organisationId, table.name),
  })
);

export type PermissionGroup = typeof permissionGroups.$inferSelect;
export type NewPermissionGroup = typeof permissionGroups.$inferInsert;
