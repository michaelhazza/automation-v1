import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index('permission_sets_org_idx').on(table.organisationId),
    // M-15: unique name per org, soft-delete-aware
    orgNameUniq: uniqueIndex('permission_sets_org_name_unique_idx')
      .on(table.organisationId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    // At most one default permission set per org
    orgDefaultUniq: uniqueIndex('permission_sets_org_default_unique_idx')
      .on(table.organisationId)
      .where(sql`${table.isDefault} = true AND ${table.deletedAt} IS NULL`),
  })
);

export type PermissionSet = typeof permissionSets.$inferSelect;
export type NewPermissionSet = typeof permissionSets.$inferInsert;
