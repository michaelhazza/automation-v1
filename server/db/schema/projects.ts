import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';
import { integrationConnections } from './integrationConnections';
import { goals } from './goals';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active').$type<'active' | 'completed' | 'archived'>(),
    color: text('color').notNull().default('#6366f1'),

    // ── Project management ─────────────────────────────────────────────
    targetDate: timestamp('target_date', { withTimezone: true }),
    budgetCents: integer('budget_cents'),
    budgetWarningPercent: integer('budget_warning_percent').default(75),

    // ── Git / GitHub integration ───────────────────────────────────────
    // Optional repo URL (e.g. https://github.com/org/repo)
    repoUrl: text('repo_url'),
    // Link to a specific GitHub App connection for this project
    githubConnectionId: uuid('github_connection_id')
      .references(() => integrationConnections.id),

    goalId: uuid('goal_id')
      .references(() => goals.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    subaccountIdx: index('projects_subaccount_idx').on(table.subaccountId),
    orgIdx: index('projects_org_idx').on(table.organisationId),
    subaccountStatusIdx: index('projects_subaccount_status_idx').on(table.subaccountId, table.status),
    goalIdx: index('projects_goal_idx').on(table.goalId),
  })
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
