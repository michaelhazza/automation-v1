import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

// ---------------------------------------------------------------------------
// Reference Documents — user-uploaded reference documents for cached context
// ---------------------------------------------------------------------------

export type ReferenceDocumentSourceType = 'manual' | 'external';

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
