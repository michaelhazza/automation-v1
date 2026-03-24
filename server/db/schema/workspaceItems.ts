import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { tasks } from './tasks';

export const workspaceItems = pgTable(
  'workspace_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    title: text('title').notNull(),
    description: text('description'),
    brief: text('brief'),
    status: text('status').notNull().default('inbox'),
    priority: text('priority').notNull().default('normal').$type<'low' | 'normal' | 'high' | 'urgent'>(),
    assignedAgentId: uuid('assigned_agent_id')
      .references(() => agents.id),
    createdByAgentId: uuid('created_by_agent_id')
      .references(() => agents.id),
    taskId: uuid('task_id')
      .references(() => tasks.id),
    position: integer('position').notNull().default(0),
    dueDate: timestamp('due_date'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    orgIdx: index('workspace_items_org_idx').on(table.organisationId),
    subaccountIdx: index('workspace_items_subaccount_idx').on(table.subaccountId),
    subaccountStatusIdx: index('workspace_items_subaccount_status_idx').on(table.subaccountId, table.status),
    assignedAgentIdx: index('workspace_items_assigned_agent_idx').on(table.assignedAgentId),
    statusIdx: index('workspace_items_status_idx').on(table.status),
  })
);

export type WorkspaceItem = typeof workspaceItems.$inferSelect;
export type NewWorkspaceItem = typeof workspaceItems.$inferInsert;
