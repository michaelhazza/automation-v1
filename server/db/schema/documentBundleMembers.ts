import { pgTable, uuid, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { documentBundles } from './documentBundles';
import { referenceDocuments } from './referenceDocuments';

// ---------------------------------------------------------------------------
// Document Bundle Members — join table linking documents to bundles
// Ordering is NOT stored; resolution computes deterministic order by documentId asc.
// ---------------------------------------------------------------------------

export const documentBundleMembers = pgTable(
  'document_bundle_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bundleId: uuid('bundle_id').notNull().references(() => documentBundles.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull().references(() => referenceDocuments.id, { onDelete: 'restrict' }),

    addedInBundleVersion: integer('added_in_bundle_version').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    removedInBundleVersion: integer('removed_in_bundle_version'),
  },
  (t) => ({
    bundleDocUniq: uniqueIndex('document_bundle_members_bundle_doc_uq')
      .on(t.bundleId, t.documentId)
      .where(sql`${t.deletedAt} IS NULL`),
    bundleIdx: index('document_bundle_members_bundle_idx').on(t.bundleId),
    docIdx: index('document_bundle_members_doc_idx').on(t.documentId),
  })
);

export type DocumentBundleMember = typeof documentBundleMembers.$inferSelect;
export type NewDocumentBundleMember = typeof documentBundleMembers.$inferInsert;
