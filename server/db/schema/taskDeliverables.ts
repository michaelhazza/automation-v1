import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { tasks } from './tasks';

export const taskDeliverables = pgTable(
  'task_deliverables',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    deliverableType: text('deliverable_type').notNull().$type<'file' | 'url' | 'artifact'>(),
    title: text('title').notNull(),
    path: text('path'),
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    taskIdx: index('task_deliverables_task_idx').on(table.taskId),
  })
);

export type TaskDeliverable = typeof taskDeliverables.$inferSelect;
export type NewTaskDeliverable = typeof taskDeliverables.$inferInsert;
