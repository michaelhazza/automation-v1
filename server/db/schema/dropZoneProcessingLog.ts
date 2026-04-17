import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { dropZoneUploadAudit } from './dropZoneUploadAudit';

/**
 * drop_zone_processing_log — append-only pipeline step audit (Item 3)
 *
 * One row per step per upload. Records whether each stage of the
 * parse → synthesize → index pipeline started, completed, or failed.
 * Enables answering "did this upload actually become memory?" and
 * "where in the pipeline did it fail?".
 *
 * Spec: docs/memory-and-briefings-spec.md §5.5 (S9) — PR Review Hardening
 */

export type DropZoneProcessingStep   = 'parse' | 'synthesize' | 'index';
export type DropZoneProcessingStatus = 'started' | 'completed' | 'failed';

export const dropZoneProcessingLog = pgTable(
  'drop_zone_processing_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    uploadAuditId: uuid('upload_audit_id')
      .notNull()
      .references(() => dropZoneUploadAudit.id, { onDelete: 'cascade' }),
    step:       text('step').notNull().$type<DropZoneProcessingStep>(),
    status:     text('status').notNull().$type<DropZoneProcessingStatus>(),
    /** Error code when status='failed'. */
    errorCode:  text('error_code'),
    /** Wall-clock ms for the step (null when status='started'). */
    durationMs: integer('duration_ms'),
    createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uploadIdx: index('drop_zone_processing_log_upload_idx').on(
      table.uploadAuditId,
      table.createdAt,
    ),
  }),
);

export type DropZoneProcessingLog    = typeof dropZoneProcessingLog.$inferSelect;
export type NewDropZoneProcessingLog = typeof dropZoneProcessingLog.$inferInsert;
