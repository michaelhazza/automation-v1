import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { users } from './users';

// ---------------------------------------------------------------------------
// Scheduled Tasks — user-configured recurring tasks
// ---------------------------------------------------------------------------

export const scheduledTasks = pgTable(
  'scheduled_tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),

    // Task template
    title: text('title').notNull(),
    description: text('description'),
    brief: text('brief'),
    priority: text('priority').notNull().default('normal').$type<'low' | 'normal' | 'high' | 'urgent'>(),
    assignedAgentId: uuid('assigned_agent_id')
      .notNull()
      .references(() => agents.id),
    createdByUserId: uuid('created_by_user_id')
      .references(() => users.id),

    // Schedule (RRULE-based)
    rrule: text('rrule').notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    scheduleTime: text('schedule_time').notNull(), // HH:MM 24hr

    // Phase B2 — logical identity + lifecycle metadata (spec §5.4.1, §5.4.2)
    taskSlug: text('task_slug'),
    createdByPlaybookSlug: text('created_by_playbook_slug'),
    firstRunAt: timestamp('first_run_at', { withTimezone: true }),
    firstRunAtTz: text('first_run_at_tz'),

    // Lifecycle
    isActive: boolean('is_active').notNull().default(true),

    // Execution config
    retryPolicy: jsonb('retry_policy').$type<{
      maxRetries: number;
      backoffMinutes: number;
      pauseAfterConsecutiveFailures: number;
    }>(),
    tokenBudgetPerRun: integer('token_budget_per_run').notNull().default(30000),

    // Scheduling state
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    totalRuns: integer('total_runs').notNull().default(0),
    totalFailures: integer('total_failures').notNull().default(0),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),

    // End conditions
    endsAt: timestamp('ends_at', { withTimezone: true }),
    endsAfterRuns: integer('ends_after_runs'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('scheduled_tasks_org_idx').on(table.organisationId),
    subaccountActiveIdx: index('scheduled_tasks_subaccount_active_idx').on(
      table.subaccountId,
      table.isActive
    ),
    nextRunIdx: index('scheduled_tasks_next_run_idx').on(
      table.nextRunAt,
      table.isActive
    ),
    // Phase B2 — partial unique index so legacy rows (slug NULL) and
    // deactivated rows do not block re-creation. See migration 0118.
    subaccountSlugActiveUniq: uniqueIndex('scheduled_tasks_subaccount_slug_active_uniq')
      .on(table.subaccountId, table.taskSlug)
      .where(sql`${table.taskSlug} IS NOT NULL AND ${table.isActive} = true`),
    playbookSlugIdx: index('scheduled_tasks_playbook_slug_idx')
      .on(table.createdByPlaybookSlug)
      .where(sql`${table.createdByPlaybookSlug} IS NOT NULL`),
  })
);

export type ScheduledTask = typeof scheduledTasks.$inferSelect;
export type NewScheduledTask = typeof scheduledTasks.$inferInsert;

// ---------------------------------------------------------------------------
// Scheduled Task Runs — individual occurrences of a scheduled task
// ---------------------------------------------------------------------------

export const scheduledTaskRuns = pgTable(
  'scheduled_task_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scheduledTaskId: uuid('scheduled_task_id')
      .notNull()
      .references(() => scheduledTasks.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id'), // FK to tasks — the generated board task
    agentRunId: uuid('agent_run_id'), // FK to agent_runs
    occurrence: integer('occurrence').notNull(),
    status: text('status').notNull().default('pending')
      .$type<'pending' | 'running' | 'completed' | 'failed' | 'retrying' | 'skipped'>(),
    attempt: integer('attempt').notNull().default(1),
    errorMessage: text('error_message'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    scheduledTaskIdx: index('scheduled_task_runs_st_idx').on(table.scheduledTaskId),
    statusIdx: index('scheduled_task_runs_status_idx').on(table.status),
    scheduledForIdx: index('scheduled_task_runs_scheduled_for_idx').on(table.scheduledFor),
  })
);

export type ScheduledTaskRun = typeof scheduledTaskRuns.$inferSelect;
export type NewScheduledTaskRun = typeof scheduledTaskRuns.$inferInsert;
