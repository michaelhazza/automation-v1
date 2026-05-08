import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex, customType } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { referenceDocuments } from './referenceDocuments';
import { referenceDocumentVersions } from './referenceDocumentVersions';

// pgvector custom type — mirrors the convention in memoryBlocks.ts.
// Nullable: embedding is populated by the chunking job (Phase 3).
const vector = customType<{ data: number[] | null }>({
  dataType() { return 'vector(1536)'; },
  toDriver(val: number[] | null): string | null {
    if (val === null) return null;
    return `[${val.join(',')}]`;
  },
  fromDriver(val: unknown): number[] | null {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') {
      return val.replace(/^\[|\]$/g, '').split(',').map(Number);
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Reference Document Chunks — per-version embedding chunks for retrieval.
// organisation_id is denormalised onto the row for RLS-policy locality
// (spec §12). Unique index on (version_id, chunk_index, embedding_model)
// is the idempotency key for the chunking job (spec §10.1 / §10.6 / §13.3).
// HNSW index (cosine distance only — spec invariant §1.5 #14) lives in the
// SQL migration only; Drizzle has no native HNSW index support.
// ---------------------------------------------------------------------------

export const referenceDocumentChunks = pgTable(
  'reference_document_chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull().references(() => referenceDocuments.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id').notNull().references(() => referenceDocumentVersions.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    embedding: vector('embedding'),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    // Idempotency key — (version_id, chunk_index, embedding_model) must be unique
    versionChunkModelUniq: uniqueIndex('rdc_version_chunk_model_uq')
      .on(t.versionId, t.chunkIndex, t.embeddingModel)
      .where(sql`${t.deletedAt} IS NULL`),
    docVersionIdx: index('rdc_doc_version_idx').on(t.documentId, t.versionId),
    orgActiveIdx: index('rdc_org_active_idx')
      .on(t.organisationId)
      .where(sql`${t.deletedAt} IS NULL`),
  })
);

export type ReferenceDocumentChunk = typeof referenceDocumentChunks.$inferSelect;
export type NewReferenceDocumentChunk = typeof referenceDocumentChunks.$inferInsert;
