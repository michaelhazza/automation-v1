import { pgTable, uuid, text, integer, bigint, jsonb, timestamp, boolean, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { ieeRuns } from './ieeRuns';

// ---------------------------------------------------------------------------
// iee_artifacts — file metadata for downloads, written files, log captures.
//
// Spec: docs/iee-development-spec.md §2.1.3.
//
// v1 records metadata only — file contents are NOT copied back to the app.
// A later phase will add object-storage upload.
// ---------------------------------------------------------------------------

export const ieeArtifacts = pgTable(
  'iee_artifacts',
  {
    id:             uuid('id').defaultRandom().primaryKey(),
    // Nullable per Code Change B (transcribe_audio): the skill executor may
    // be invoked from non-IEE agent runs where there is no parent IEE run.
    // The persisted artifact still carries organisationId for tenant scoping
    // and metadata.runId for parent-run tracing. Spec v3.4 §4.4.1.
    ieeRunId:       uuid('iee_run_id').references(() => ieeRuns.id, { onDelete: 'cascade' }),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),

    kind:           text('kind').notNull().$type<'download' | 'file' | 'log'>(),
    path:           text('path').notNull(),
    sizeBytes:      bigint('size_bytes', { mode: 'number' }),
    mimeType:       text('mime_type'),
    metadata:       jsonb('metadata'),

    // Inline text body for small text artifacts (≤1 MB after UTF-8-safe
    // truncation). Used so transcripts and other small text outputs survive
    // worker container cleanup. T12 / spec v3.4 §6.7.3.
    inlineText:           text('inline_text'),
    inlineTextTruncated:  boolean('inline_text_truncated').notNull().default(false),

    createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runIdx:        index('iee_artifacts_run_idx').on(table.ieeRunId),
    orgCreatedIdx: index('iee_artifacts_org_created_idx').on(table.organisationId, table.createdAt),
  }),
);

export type IeeArtifact = typeof ieeArtifacts.$inferSelect;
export type NewIeeArtifact = typeof ieeArtifacts.$inferInsert;
