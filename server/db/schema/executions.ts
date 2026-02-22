import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { tasks } from './tasks.js';
import { users } from './users.js';

export const executions = pgTable(
  'executions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull().default('pending').$type<'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'>(),
    inputData: jsonb('input_data'),
    outputData: jsonb('output_data'),
    errorMessage: text('error_message'),
    errorDetail: jsonb('error_detail'),
    engineType: text('engine_type').notNull(),
    taskSnapshot: jsonb('task_snapshot'),
    isTestExecution: boolean('is_test_execution').notNull().default(false),
    retryCount: integer('retry_count').notNull().default(0),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    orgStatusIdx: index('executions_org_status_idx').on(table.organisationId, table.status),
    orgTaskIdx: index('executions_org_task_idx').on(table.organisationId, table.taskId),
    orgUserIdx: index('executions_org_user_idx').on(table.organisationId, table.userId),
    orgCreatedAtIdx: index('executions_org_created_at_idx').on(table.organisationId, table.createdAt),
    userTaskCreatedAtIdx: index('executions_user_task_created_at_idx').on(table.userId, table.taskId, table.createdAt),
    orgIdIdx: index('executions_org_id_idx').on(table.organisationId),
    taskIdx: index('executions_task_idx').on(table.taskId),
    userIdx: index('executions_user_idx').on(table.userId),
    statusIdx: index('executions_status_idx').on(table.status),
  })
);

export type Execution = typeof executions.$inferSelect;
export type NewExecution = typeof executions.$inferInsert;
