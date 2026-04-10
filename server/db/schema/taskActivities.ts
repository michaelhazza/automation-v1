import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { tasks } from './tasks';
import { agents } from './agents';
import { users } from './users';

export const taskActivities = pgTable(
  'task_activities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .references(() => agents.id),
    userId: uuid('user_id')
      .references(() => users.id),
    activityType: text('activity_type').notNull().$type<'created' | 'assigned' | 'status_changed' | 'progress' | 'completed' | 'note' | 'blocked' | 'deliverable_added'>(),
    message: text('message').notNull(),
    metadata: jsonb('metadata'),
    // Optional reference to the agent run that created this activity
    agentRunId: uuid('agent_run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    taskIdx: index('task_activities_task_idx').on(table.taskId),
    taskCreatedIdx: index('task_activities_task_created_idx').on(table.taskId, table.createdAt),
    agentIdx: index('task_activities_agent_idx').on(table.agentId),
  })
);

export type TaskActivity = typeof taskActivities.$inferSelect;
export type NewTaskActivity = typeof taskActivities.$inferInsert;
