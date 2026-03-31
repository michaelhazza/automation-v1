import { pgTable, uuid, text, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';
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
    authType: text('auth_type').notNull().$type<'oauth2' | 'api_key' | 'service_account'>(),
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
