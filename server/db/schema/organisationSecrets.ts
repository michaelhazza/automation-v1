import { pgTable, uuid, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';

// ---------------------------------------------------------------------------
// Organisation Secrets — one row per org, stores the AES-256-GCM encrypted
// master key used to encrypt integration connection tokens.
//
// The encryption_key_enc column holds the org key itself encrypted with
// the server-level KEK from ENCRYPTION_MASTER_KEY env var, so plaintext
// keys never reach disk or logs.
// ---------------------------------------------------------------------------

export const organisationSecrets = pgTable(
  'organisation_secrets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),

    // AES-256-GCM encrypted org key: base64(iv + authTag + ciphertext)
    encryptionKeyEnc: text('encryption_key_enc').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  },
  (table) => ({
    orgUnique: unique('organisation_secrets_org_unique').on(table.organisationId),
  }),
);

export type OrganisationSecret = typeof organisationSecrets.$inferSelect;
export type NewOrganisationSecret = typeof organisationSecrets.$inferInsert;
