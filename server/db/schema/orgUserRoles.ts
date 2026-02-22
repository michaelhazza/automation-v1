import { pgTable, uuid, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { users } from './users';
import { permissionSets } from './permissionSets';

export const orgUserRoles = pgTable(
  'org_user_roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    permissionSetId: uuid('permission_set_id')
      .notNull()
      .references(() => permissionSets.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    orgUserUniqueIdx: uniqueIndex('org_user_roles_org_user_unique_idx').on(
      table.organisationId,
      table.userId
    ),
    orgIdx: index('org_user_roles_org_idx').on(table.organisationId),
    userIdx: index('org_user_roles_user_idx').on(table.userId),
  })
);

export type OrgUserRole = typeof orgUserRoles.$inferSelect;
export type NewOrgUserRole = typeof orgUserRoles.$inferInsert;
