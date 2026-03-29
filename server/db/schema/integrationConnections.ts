import { pgTable, uuid, text, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

// ---------------------------------------------------------------------------
// Integration Connections — stored external service credentials per subaccount
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
    providerType: text('provider_type').notNull().$type<'gmail' | 'github' | 'hubspot' | 'custom'>(),
    authType: text('auth_type').notNull().$type<'oauth2' | 'api_key' | 'service_account'>(),
    connectionStatus: text('connection_status').notNull().default('active').$type<'active' | 'revoked' | 'error'>(),
    displayName: text('display_name'),
    configJson: jsonb('config_json'),
    secretsRef: text('secrets_ref'),
    lastVerifiedAt: timestamp('last_verified_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    subaccountProviderUnique: unique('integration_connections_subaccount_provider').on(table.subaccountId, table.providerType),
  })
);

export type IntegrationConnection = typeof integrationConnections.$inferSelect;
export type NewIntegrationConnection = typeof integrationConnections.$inferInsert;
