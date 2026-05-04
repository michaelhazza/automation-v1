import { pgTable, text, uuid, timestamp, index } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// OAuth State Nonces — Postgres-backed CSRF state store for OAuth flows.
// Replaces the in-memory Map in ghlOAuthStateStore.ts (S-P0-1, S-P0-2).
// Single-use: consumed via DELETE...RETURNING on validation.
// TTL cleanup via oauthStateCleanupJob.ts.
// ---------------------------------------------------------------------------

export const oauthStateNonces = pgTable(
  'oauth_state_nonces',
  {
    nonce:          text('nonce').primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    expiresAt:      timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    expiresIdx: index('idx_oauth_state_nonces_expires').on(table.expiresAt),
  }),
);

export type OauthStateNonce = typeof oauthStateNonces.$inferSelect;
export type NewOauthStateNonce = typeof oauthStateNonces.$inferInsert;
