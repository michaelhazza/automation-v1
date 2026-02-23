import { pgTable, uuid, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';

export const permissionSets = pgTable(
  'permission_sets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    name: text('name').notNull(),
    description: text('description'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    orgIdx: index('permission_sets_org_idx').on(table.organisationId),
    orgNameIdx: index('permission_sets_org_name_idx').on(table.organisationId, table.name),
  })
);

export type PermissionSet = typeof permissionSets.$inferSelect;
export type NewPermissionSet = typeof permissionSets.$inferInsert;
