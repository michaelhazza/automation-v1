import { pgTable, uuid, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { referenceDocuments } from './referenceDocuments';

export const documentPromotionAudit = pgTable(
  'document_promotion_audit',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    fileId: uuid('file_id').notNull(),
    documentId: uuid('document_id').notNull().references(() => referenceDocuments.id),
    principalId: uuid('principal_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    uniquePerFile: uniqueIndex('document_promotion_audit_unique_per_file')
      .on(t.fileId)
      .where(sql`${t.deletedAt} IS NULL`),
    orgIdx: index('document_promotion_audit_org_idx').on(t.organisationId),
  })
);

export type DocumentPromotionAudit = typeof documentPromotionAudit.$inferSelect;
export type NewDocumentPromotionAudit = typeof documentPromotionAudit.$inferInsert;
