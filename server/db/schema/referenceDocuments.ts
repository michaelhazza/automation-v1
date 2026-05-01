import { pgTable, uuid, text, varchar, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { integrationConnections } from './integrationConnections';
import { users } from './users';

// ---------------------------------------------------------------------------
// Reference Documents — user-uploaded reference documents for cached context
// ---------------------------------------------------------------------------

export type ReferenceDocumentSourceType = 'manual' | 'external' | 'google_drive';

export const referenceDocuments = pgTable(
  'reference_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),

    name: text('name').notNull(),
    description: text('description'),

    // Soft FK to reference_document_versions.id — FK constraint added in 0203
    // to avoid circular dependency (same pattern as memory_blocks.activeVersionId).
    currentVersionId: uuid('current_version_id'),
    currentVersion: integer('current_version').notNull().default(0),

    // Deferred v2 connector fields — v1 only writes 'manual'.
    sourceType: text('source_type').notNull().default('manual').$type<ReferenceDocumentSourceType>(),
    sourceRef: text('source_ref'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),

    // Lifecycle flags.
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
    deprecationReason: text('deprecation_reason'),

    // External document reference fields (google_drive and future providers).
    externalProvider:     varchar('external_provider', { length: 64 }),
    externalConnectionId: uuid('external_connection_id').references(() => integrationConnections.id, { onDelete: 'set null' }),
    externalFileId:       varchar('external_file_id', { length: 1024 }),
    externalFileName:     varchar('external_file_name', { length: 512 }),
    externalFileMimeType: varchar('external_file_mime_type', { length: 256 }),
    attachedByUserId:     uuid('attached_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    attachmentOrder:      integer('attachment_order').notNull().default(0),
    attachmentState:      varchar('attachment_state', { length: 32 }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    orgNameUniq: uniqueIndex('reference_documents_org_name_uq')
      .on(t.organisationId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    orgIdx: index('reference_documents_org_idx').on(t.organisationId),
    subaccountIdx: index('reference_documents_subaccount_idx')
      .on(t.subaccountId)
      .where(sql`${t.subaccountId} IS NOT NULL`),
    activeIdx: index('reference_documents_active_idx')
      .on(t.organisationId, t.subaccountId)
      .where(sql`${t.deletedAt} IS NULL AND ${t.deprecatedAt} IS NULL AND ${t.pausedAt} IS NULL`),
  })
);

export type ReferenceDocument = typeof referenceDocuments.$inferSelect;
export type NewReferenceDocument = typeof referenceDocuments.$inferInsert;

export const ATTACHMENT_STATES = ['active', 'degraded', 'broken'] as const;
export type AttachmentState = (typeof ATTACHMENT_STATES)[number];
