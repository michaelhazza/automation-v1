import { pgTable, uuid, text, integer, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { tasks } from './tasks';
import { users } from './users';
import { agents } from './agents';

// ---------------------------------------------------------------------------
// Task Attachments — file uploads on tasks (images, PDFs, markdown, text)
// ---------------------------------------------------------------------------

export const taskAttachments = pgTable(
  'task_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    fileName: text('file_name').notNull(),
    fileType: text('file_type').notNull(), // MIME type
    fileSizeBytes: integer('file_size_bytes').notNull(),
    storageKey: text('storage_key').notNull(), // S3 key or local path
    storageProvider: text('storage_provider').notNull().default('local').$type<'local' | 's3'>(),
    thumbnailKey: text('thumbnail_key'), // for images only
    uploadedBy: uuid('uploaded_by')
      .references(() => users.id),
    uploadedByAgentId: uuid('uploaded_by_agent_id')
      .references(() => agents.id),
    idempotencyKey: text('idempotency_key'), // client-generated UUID for dedup
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    taskIdx: index('task_attach_task_idx').on(table.taskId),
    orgIdx: index('task_attach_org_idx').on(table.organisationId),
    idempotencyUniq: unique('task_attach_idempotency').on(table.taskId, table.idempotencyKey),
  })
);

export type TaskAttachment = typeof taskAttachments.$inferSelect;
export type NewTaskAttachment = typeof taskAttachments.$inferInsert;
