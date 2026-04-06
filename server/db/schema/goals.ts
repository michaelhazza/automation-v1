import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { users } from './users';

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    parentGoalId: uuid('parent_goal_id')
      .references((): any => goals.id),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active').$type<'planned' | 'active' | 'completed' | 'archived'>(),
    level: text('level').notNull().default('objective').$type<'mission' | 'objective' | 'key_result'>(),
    ownerAgentId: uuid('owner_agent_id')
      .references(() => agents.id),
    targetDate: timestamp('target_date', { withTimezone: true }),
    position: integer('position').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    subaccountIdx: index('goals_subaccount_idx').on(table.subaccountId),
    orgIdx: index('goals_org_idx').on(table.organisationId),
    parentIdx: index('goals_parent_idx').on(table.parentGoalId),
    subaccountStatusIdx: index('goals_subaccount_status_idx').on(table.subaccountId, table.status),
  })
);

export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
