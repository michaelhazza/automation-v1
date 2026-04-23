import { pgTable, uuid, text, integer, jsonb, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { referenceDocuments } from './referenceDocuments';
import { users } from './users';

// ---------------------------------------------------------------------------
// Reference Document Versions — immutable content revisions
// Version rows are NEVER deleted. This is the load-bearing guarantee behind
// per-run reproducibility + hash-verification (§5.2 invariant).
// ---------------------------------------------------------------------------

export type ReferenceDocumentChangeSource = 'manual_upload' | 'manual_edit' | 'external_sync';

export type ReferenceDocumentTokenCounts = Record<
  'anthropic.claude-sonnet-4-6' | 'anthropic.claude-opus-4-7' | 'anthropic.claude-haiku-4-5',
  number
>;

export const referenceDocumentVersions = pgTable(
  'reference_document_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => referenceDocuments.id, { onDelete: 'cascade' }),

    version: integer('version').notNull(),

    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),

    tokenCounts: jsonb('token_counts').notNull().$type<ReferenceDocumentTokenCounts>(),

    serializedBytesHash: text('serialized_bytes_hash').notNull(),

    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    changeSource: text('change_source').notNull().$type<ReferenceDocumentChangeSource>(),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    docVersionUniq: unique('reference_document_versions_doc_version_uq').on(t.documentId, t.version),
    docVersionIdx: index('reference_document_versions_doc_version_idx').on(t.documentId, t.version),
    contentHashIdx: index('reference_document_versions_content_hash_idx').on(t.contentHash),
  })
);

export type ReferenceDocumentVersion = typeof referenceDocumentVersions.$inferSelect;
export type NewReferenceDocumentVersion = typeof referenceDocumentVersions.$inferInsert;
