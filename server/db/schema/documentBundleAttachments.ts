import { pgTable, uuid, text, varchar, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { documentBundles } from './documentBundles';
import { users } from './users';

// ---------------------------------------------------------------------------
// Document Bundle Attachments — polymorphic link from a bundle to a subject
// subject_type ∈ 'agent' | 'task' | 'scheduled_task'
// No DB-level FK on subject_id — polymorphic, service-enforced.
// ---------------------------------------------------------------------------

export type AttachmentSubjectType = 'agent' | 'task' | 'scheduled_task';
/** v1 always uses 'always_load'. 'available_on_demand' is reserved for v2 retrieval mode (§12.6). */
export type AttachmentMode = 'always_load' | 'available_on_demand';

export const documentBundleAttachments = pgTable(
  'document_bundle_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),

    bundleId: uuid('bundle_id').notNull().references(() => documentBundles.id, { onDelete: 'cascade' }),

    subjectType: text('subject_type').notNull().$type<AttachmentSubjectType>(),
    subjectId: uuid('subject_id').notNull(),

    attachmentMode: text('attachment_mode').notNull().default('always_load').$type<AttachmentMode>(),

    attachedByUserId: uuid('attached_by_user_id').references(() => users.id),

    fetchFailurePolicy: varchar('fetch_failure_policy', { length: 32 }).notNull().default('tolerant'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    bundleSubjectUniq: uniqueIndex('document_bundle_attachments_bundle_subject_uq')
      .on(t.bundleId, t.subjectType, t.subjectId)
      .where(sql`${t.deletedAt} IS NULL`),
    subjectIdx: index('document_bundle_attachments_subject_idx').on(t.subjectType, t.subjectId),
    orgIdx: index('document_bundle_attachments_org_idx').on(t.organisationId),
  })
);

export type DocumentBundleAttachment = typeof documentBundleAttachments.$inferSelect;
export type NewDocumentBundleAttachment = typeof documentBundleAttachments.$inferInsert;

export const FETCH_FAILURE_POLICIES = ['tolerant', 'strict', 'best_effort'] as const;
export type FetchFailurePolicy = (typeof FETCH_FAILURE_POLICIES)[number];
