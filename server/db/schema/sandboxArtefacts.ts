import { pgTable, uuid, text, integer, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { subaccounts } from './subaccounts.js';

// ---------------------------------------------------------------------------
// sandbox_artefacts — pointer rows for harvested artefacts (spec §20.4).
// One row per artefact file. Idempotent on (sandbox_execution_id, filename).
// ---------------------------------------------------------------------------

export const sandboxArtefacts = pgTable(
  'sandbox_artefacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sandboxExecutionId: uuid('sandbox_execution_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id, { onDelete: 'restrict' }),

    // Artefact metadata
    filename: text('filename').notNull(),
    objectKey: text('object_key').notNull(),
    bytes: integer('bytes').notNull(),
    contentHash: text('content_hash').notNull(),
    // Content-sniffed MIME type (spec §9.6)
    mime: text('mime').notNull(),

    // Retention lifecycle (spec §17.3)
    objectStorageState: text('object_storage_state').notNull().default('uploaded')
      .$type<'uploaded' | 'expired' | 'purged'>(),

    // Soft-delete flag (spec §17.4)
    isActive: boolean('is_active').notNull().default(true),

    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // DB-level idempotency: one row per artefact file per execution (spec §20.4)
    executionFilenameUniq: uniqueIndex('sandbox_artefacts_execution_filename_uniq')
      .on(table.sandboxExecutionId, table.filename),
    orgUploadedAtIdx: index('sandbox_artefacts_org_uploaded_at_idx').on(table.organisationId, table.uploadedAt),
    executionIdIdx: index('sandbox_artefacts_execution_id_idx').on(table.sandboxExecutionId),
  }),
);

export type SandboxArtefact = typeof sandboxArtefacts.$inferSelect;
export type NewSandboxArtefact = typeof sandboxArtefacts.$inferInsert;
