import { pgTable, uuid, text, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

/**
 * drop_zone_upload_audit — append-only audit log for every drop-zone upload
 * (§5.5 S9). Immutable by design: no deletedAt, no updatedAt trigger.
 *
 * Required indexes:
 *   (subaccount_id, created_at DESC) — digest + timeline queries
 *   (file_hash)                       — dedupe detection
 *   (subaccount_id, uploader_role, created_at DESC) — compliance splits
 */
export const dropZoneUploadAudit = pgTable(
  'drop_zone_upload_audit',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),

    /** Null for client-portal uploads. */
    uploaderUserId: uuid('uploader_user_id'),
    uploaderRole: text('uploader_role').notNull().$type<'agency_staff' | 'client_contact'>(),

    fileName: text('file_name').notNull(),
    /** sha256 hex. */
    fileHash: text('file_hash').notNull(),

    proposedDestinations: jsonb('proposed_destinations').notNull(),
    selectedDestinations: jsonb('selected_destinations').notNull(),
    appliedDestinations: jsonb('applied_destinations'),

    requiredApproval: boolean('required_approval').notNull(),
    approvedByUserId: uuid('approved_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** Null if rejected or still pending. */
    appliedAt: timestamp('applied_at', { withTimezone: true }),
  },
  (table) => ({
    subaccountCreatedIdx: index('drop_zone_upload_audit_subaccount_created_idx').on(
      table.subaccountId,
      table.createdAt,
    ),
    fileHashIdx: index('drop_zone_upload_audit_file_hash_idx').on(table.fileHash),
    roleCreatedIdx: index('drop_zone_upload_audit_role_created_idx').on(
      table.subaccountId,
      table.uploaderRole,
      table.createdAt,
    ),
  }),
);

export type DropZoneUploadAudit = typeof dropZoneUploadAudit.$inferSelect;
export type NewDropZoneUploadAudit = typeof dropZoneUploadAudit.$inferInsert;
