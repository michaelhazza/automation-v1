import { pgTable, uuid, text, bigint, timestamp, index } from 'drizzle-orm/pg-core';
import { executions } from './executions';

export const executionFiles = pgTable(
  'execution_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id),
    fileName: text('file_name').notNull(),
    fileType: text('file_type').notNull().$type<'input' | 'output'>(),
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type'),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    executionFileTypeIdx: index('execution_files_exec_type_idx').on(table.executionId, table.fileType),
    expiresAtIdx: index('execution_files_expires_at_idx').on(table.expiresAt),
    executionIdx: index('execution_files_execution_idx').on(table.executionId),
  })
);

export type ExecutionFile = typeof executionFiles.$inferSelect;
export type NewExecutionFile = typeof executionFiles.$inferInsert;
