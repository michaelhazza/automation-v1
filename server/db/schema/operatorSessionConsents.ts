import { pgTable, uuid, text, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';

// ---------------------------------------------------------------------------
// Operator Session Consents — consent audit log
//
// One row per user acceptance of a disclosure version for a given connection.
// Immutable after INSERT: the application layer must never UPDATE rows in
// this table (enforced by CI gate
// scripts/verify-operator-session-consent-immutable.sh).
//
// Spec: docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md §7.1, §8.1
// Migration: 0325_operator_session_consents.sql
// ---------------------------------------------------------------------------

export const operatorSessionConsents = pgTable(
  'operator_session_consents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    // Nullable on INSERT; filled by post-INSERT UPDATE once the
    // integration_connections row exists (spec §7.2 FK bootstrap order).
    // Drizzle .references() omitted here to avoid circular import with
    // integrationConnections (which FKs back to this table via consentRecordId).
    // The FK is enforced at the database layer in migration 0321.
    connectionId: uuid('connection_id'),
    planTier: text('plan_tier').notNull(),
    disclosureVersion: integer('disclosure_version').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    disclosureTextSnapshot: text('disclosure_text_snapshot').notNull(),
    consentTextSnapshot: text('consent_text_snapshot').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    connectionDisclosureUnique: uniqueIndex('operator_session_consents_connection_disclosure_unique')
      .on(table.connectionId, table.disclosureVersion),
  })
);

export type OperatorSessionConsent = typeof operatorSessionConsents.$inferSelect;
export type NewOperatorSessionConsent = typeof operatorSessionConsents.$inferInsert;
