import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';

// pgvector custom type — stores embedding as vector(1536) in Postgres
const vector = customType<{ data: number[] }>({
  dataType() { return 'vector(1536)'; },
  toDriver(val: number[]): string {
    return `[${val.join(',')}]`;
  },
  fromDriver(val: unknown): number[] {
    if (typeof val === 'string') {
      return val.replace(/^\[|\]$/g, '').split(',').map(Number);
    }
    return [];
  },
});

// ---------------------------------------------------------------------------
// Skill Embeddings — content-addressed embedding cache
// Shared across system skills, org skills, and import candidates.
// Keyed by SHA-256 of normalized skill content — same content is never
// embedded twice regardless of source.
//
// NOTE: source_type and source_identifier are provenance/debugging columns
// only. Because the table upserts on content_hash, these columns reflect the
// last writer. Do not use them for source-filtered queries.
// ---------------------------------------------------------------------------

export const skillEmbeddings = pgTable(
  'skill_embeddings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    contentHash: text('content_hash').notNull(),
    sourceType: text('source_type')
      .notNull()
      .$type<'system' | 'org' | 'candidate'>(),
    sourceIdentifier: text('source_identifier').notNull(),
    embedding: vector('embedding').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    hashIdx: uniqueIndex('skill_embeddings_hash_idx').on(table.contentHash),
    sourceIdx: index('skill_embeddings_source_idx').on(
      table.sourceType,
      table.sourceIdentifier
    ),
  })
);

export type SkillEmbedding = typeof skillEmbeddings.$inferSelect;
export type NewSkillEmbedding = typeof skillEmbeddings.$inferInsert;
