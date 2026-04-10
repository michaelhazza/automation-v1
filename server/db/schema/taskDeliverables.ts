import { pgTable, uuid, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { tasks } from './tasks';

export const taskDeliverables = pgTable(
  'task_deliverables',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    deliverableType: text('deliverable_type').notNull().$type<'file' | 'url' | 'artifact'>(),
    title: text('title').notNull(),
    path: text('path'),
    description: text('description'),
    // Inline body for text deliverables (≤2 MB after UTF-8-safe truncation).
    // Source of truth for the deliverable; the path field can become stale
    // if the file is later deleted from worker disk. T12 / spec v3.4 §6.7.3.
    bodyText: text('body_text'),
    bodyTextTruncated: boolean('body_text_truncated').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    taskIdx: index('task_deliverables_task_idx').on(table.taskId).where(sql`${table.deletedAt} IS NULL`),
  })
);

export type TaskDeliverable = typeof taskDeliverables.$inferSelect;
export type NewTaskDeliverable = typeof taskDeliverables.$inferInsert;
