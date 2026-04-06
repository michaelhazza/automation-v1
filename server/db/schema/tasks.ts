import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { processes } from './processes';
import { projects } from './projects';
import { goals } from './goals';

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    title: text('title').notNull(),
    description: text('description'),
    brief: text('brief'),
    status: text('status').notNull().default('inbox'),
    priority: text('priority').notNull().default('normal').$type<'low' | 'normal' | 'high' | 'urgent'>(),
    assignedAgentId: uuid('assigned_agent_id')
      .references(() => agents.id),
    // All agents assigned to this task (may include the primary assignedAgentId)
    assignedAgentIds: jsonb('assigned_agent_ids').$type<string[]>().default([]),
    createdByAgentId: uuid('created_by_agent_id')
      .references(() => agents.id),
    processId: uuid('process_id')
      .references(() => processes.id),
    projectId: uuid('project_id')
      .references(() => projects.id),
    goalId: uuid('goal_id')
      .references(() => goals.id),
    position: integer('position').notNull().default(0),
    dueDate: timestamp('due_date', { withTimezone: true }),

    // ── Handoff tracking ──────────────────────────────────────────────────
    handoffSourceRunId: uuid('handoff_source_run_id'),
    handoffContext: jsonb('handoff_context'),
    handoffDepth: integer('handoff_depth').notNull().default(0),

    // ── Review gate escalation ─────────────────────────────────────────────
    // When true, all actions produced while an agent works this task escalate to review
    reviewRequired: boolean('review_required').notNull().default(false),

    // ── Sub-agent tracking ────────────────────────────────────────────────
    // M-10: proper boolean (was integer 0/1)
    isSubTask: boolean('is_sub_task').notNull().default(false),
    parentTaskId: uuid('parent_task_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index('tasks_org_idx').on(table.organisationId),
    subaccountIdx: index('tasks_subaccount_idx').on(table.subaccountId),
    subaccountStatusIdx: index('tasks_subaccount_status_idx').on(table.subaccountId, table.status),
    assignedAgentIdx: index('tasks_assigned_agent_idx').on(table.assignedAgentId),
    statusIdx: index('tasks_status_idx').on(table.status),
    projectIdx: index('tasks_project_idx').on(table.projectId),
    goalIdx: index('tasks_goal_idx').on(table.goalId),
    // M-4: index for sub-task queries
    parentTaskIdx: index('tasks_parent_task_id_idx').on(table.parentTaskId),
  })
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
