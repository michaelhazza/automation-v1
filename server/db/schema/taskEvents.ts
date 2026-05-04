import { pgTable, uuid, text, integer, jsonb, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { tasks } from './tasks';

// ---------------------------------------------------------------------------
// Task Events — durable typed per-task event log.
// Migration 0279. Spec: tasks/builds/pre-launch-hardening/plan.md D-P0-5.
//
// seq is allocated atomically from tasks.next_event_seq (same counter used
// by taskEventService). The UNIQUE (task_id, seq) constraint prevents gaps
// and duplicate sequences at the DB level.
// ---------------------------------------------------------------------------

export const taskEvents = pgTable(
  'task_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    organisationId: uuid('organisation_id').notNull(),
    subaccountId: uuid('subaccount_id'),
    seq: integer('seq').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    origin: text('origin').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqTaskSeq: unique('task_events_task_id_seq_unique').on(t.taskId, t.seq),
    taskSeqIdx: index('idx_task_events_task_seq').on(t.taskId, t.seq),
    orgTimeIdx: index('idx_task_events_org_time').on(t.organisationId, t.createdAt),
  }),
);

export type TaskEvent = typeof taskEvents.$inferSelect;
export type NewTaskEvent = typeof taskEvents.$inferInsert;
