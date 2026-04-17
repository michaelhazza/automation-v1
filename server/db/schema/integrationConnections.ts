import { pgTable, uuid, text, integer, bigint, jsonb, timestamp, unique, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';

// ---------------------------------------------------------------------------
// Integration Connections — stored external service credentials per org or subaccount
// Supports multiple connections per provider via label differentiation.
// Org-level connections (subaccountId IS NULL) are shared across all subaccounts.
// ---------------------------------------------------------------------------

export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    providerType: text('provider_type').notNull().$type<'gmail' | 'github' | 'hubspot' | 'slack' | 'ghl' | 'stripe' | 'teamwork' | 'web_login' | 'custom'>(),
    // Note: 'web_login' uses authType 'service_account' (username + password
    // stored in configJson + secretsRef respectively). Spec v3.4 §6 / Code Change D.
    authType: text('auth_type').notNull().$type<'oauth2' | 'api_key' | 'service_account' | 'github_app' | 'web_login'>(),
    connectionStatus: text('connection_status').notNull().default('active').$type<'active' | 'revoked' | 'error'>(),
    // Label to distinguish multiple connections of the same provider (e.g. "Support Gmail", "Personal Gmail")
    label: text('label'),
    displayName: text('display_name'),
    configJson: jsonb('config_json'),
    secretsRef: text('secrets_ref'),
    // Explicit OAuth2 token fields (encrypted at rest)
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),

    // OAuth-specific fields (Activepieces pattern — Phase 1B)
    // Store claimed_at + expires_in rather than expires_at to avoid clock drift
    claimedAt: bigint('claimed_at', { mode: 'number' }),   // Unix seconds
    expiresIn: integer('expires_in'),                       // seconds until expiry
    tokenUrl: text('token_url'),                            // stored for refresh calls
    clientIdEnc: text('client_id_enc'),                     // AES-256-GCM encrypted
    clientSecretEnc: text('client_secret_enc'),             // AES-256-GCM encrypted
    oauthStatus: text('oauth_status').default('active')
      .$type<'active' | 'expired' | 'error' | 'disconnected'>(),

    // P3A: ownership, classification, and visibility (migration 0163)
    ownershipScope: text('ownership_scope').notNull().default('subaccount').$type<'user' | 'subaccount' | 'organisation'>(),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    classification: text('classification').notNull().default('shared_mailbox').$type<'personal' | 'shared_mailbox' | 'service_account'>(),
    visibilityScope: text('visibility_scope').notNull().default('shared_subaccount').$type<'private' | 'shared_team' | 'shared_subaccount' | 'shared_org'>(),
    sharedTeamIds: uuid('shared_team_ids').array().notNull().default(sql`'{}'`),

    // P1 scheduled polling — sync tracking columns (migration 0160)
    lastSuccessfulSyncAt: timestamp('last_successful_sync_at', { withTimezone: true }),
    lastSyncStartedAt: timestamp('last_sync_started_at', { withTimezone: true }),
    lastSyncError: text('last_sync_error'),
    lastSyncErrorAt: timestamp('last_sync_error_at', { withTimezone: true }),
    syncPhase: text('sync_phase').notNull().default('backfill').$type<'backfill' | 'transition' | 'live'>(),
    syncLockToken: uuid('sync_lock_token'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Subaccount-scoped: one connection per (subaccount, provider, label)
    subaccountProviderLabelUnique: uniqueIndex('ic_subaccount_provider_label_unique')
      .on(table.subaccountId, table.providerType, table.label)
      .where(sql`${table.subaccountId} IS NOT NULL`),
    // Org-scoped: one connection per (org, provider, label) when subaccountId IS NULL
    orgProviderLabelUnique: uniqueIndex('ic_org_provider_label_unique')
      .on(table.organisationId, table.providerType, table.label)
      .where(sql`${table.subaccountId} IS NULL`),
    subaccountIdx: index('integration_connections_subaccount_idx').on(table.subaccountId),
    orgIdx: index('integration_connections_org_idx').on(table.organisationId),
  })
);

export type IntegrationConnection = typeof integrationConnections.$inferSelect;
export type NewIntegrationConnection = typeof integrationConnections.$inferInsert;
