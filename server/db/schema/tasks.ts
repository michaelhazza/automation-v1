import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { processes } from './processes';

export const tasks = pgTable(
  'tasks',
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
    processId: uuid('process_id')
      .references(() => processes.id),
    position: integer('position').notNull().default(0),
    dueDate: timestamp('due_date'),

    // ── Handoff tracking ──────────────────────────────────────────────────
    handoffSourceRunId: uuid('handoff_source_run_id'),
    handoffContext: jsonb('handoff_context'),
    handoffDepth: integer('handoff_depth').notNull().default(0),

    // ── Sub-agent tracking ────────────────────────────────────────────────
    isSubTask: integer('is_sub_task').notNull().default(0), // 0=false, 1=true
    parentTaskId: uuid('parent_task_id'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    orgIdx: index('tasks_org_idx').on(table.organisationId),
    subaccountIdx: index('tasks_subaccount_idx').on(table.subaccountId),
    subaccountStatusIdx: index('tasks_subaccount_status_idx').on(table.subaccountId, table.status),
    assignedAgentIdx: index('tasks_assigned_agent_idx').on(table.assignedAgentId),
    statusIdx: index('tasks_status_idx').on(table.status),
  })
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
