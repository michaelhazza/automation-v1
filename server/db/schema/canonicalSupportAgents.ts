import { pgTable, uuid, text, boolean, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { connectorConfigs } from './connectorConfigs.js';
import { subaccounts } from './subaccounts.js';
import { integrationConnections } from './integrationConnections.js';

export const canonicalSupportAgents = pgTable(
  'canonical_support_agents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    connectorConfigId: uuid('connector_config_id').notNull().references(() => connectorConfigs.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    externalId: text('external_id').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email'),
    isActive: boolean('is_active').notNull().default(true),
    agentKind: text('agent_kind').notNull().$type<'human' | 'bot'>(),
    externalMetadata: jsonb('external_metadata').$type<Record<string, unknown>>(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    sourceConnectionId: uuid('source_connection_id').references(() => integrationConnections.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    connectorExternalUnique: uniqueIndex('canonical_support_agents_connector_external_unique').on(table.connectorConfigId, table.externalId),
    orgKindActiveIdx: index('canonical_support_agents_org_kind_active_idx').on(table.organisationId, table.agentKind, table.isActive),
  })
);

export type CanonicalSupportAgent = typeof canonicalSupportAgents.$inferSelect;
export type NewCanonicalSupportAgent = typeof canonicalSupportAgents.$inferInsert;
