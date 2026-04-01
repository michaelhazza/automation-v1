import { pgTable, uuid, text, integer, bigint, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

// ---------------------------------------------------------------------------
// Integration Connections — stored external service credentials per subaccount
// Supports multiple connections per provider via label differentiation.
// ---------------------------------------------------------------------------

export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    providerType: text('provider_type').notNull().$type<'gmail' | 'github' | 'hubspot' | 'slack' | 'ghl' | 'custom'>(),
    authType: text('auth_type').notNull().$type<'oauth2' | 'api_key' | 'service_account' | 'github_app'>(),
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

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    subaccountProviderLabelUnique: unique('integration_connections_subaccount_provider_label').on(
      table.subaccountId, table.providerType, table.label
    ),
    subaccountIdx: index('integration_connections_subaccount_idx').on(table.subaccountId),
    orgIdx: index('integration_connections_org_idx').on(table.organisationId),
  })
);

export type IntegrationConnection = typeof integrationConnections.$inferSelect;
export type NewIntegrationConnection = typeof integrationConnections.$inferInsert;
