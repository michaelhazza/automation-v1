import { pgTable, uuid, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { subaccounts } from './subaccounts';
import { users } from './users';
import { permissionSets } from './permissionSets';

export const subaccountUserAssignments = pgTable(
  'subaccount_user_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
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
    subaccountUserUniqueIdx: uniqueIndex('subaccount_user_assignments_subaccount_user_unique_idx').on(
      table.subaccountId,
      table.userId
    ),
    subaccountIdx: index('subaccount_user_assignments_subaccount_idx').on(table.subaccountId),
    userIdx: index('subaccount_user_assignments_user_idx').on(table.userId),
  })
);

export type SubaccountUserAssignment = typeof subaccountUserAssignments.$inferSelect;
export type NewSubaccountUserAssignment = typeof subaccountUserAssignments.$inferInsert;
