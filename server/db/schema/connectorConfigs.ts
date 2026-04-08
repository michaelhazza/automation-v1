import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { subaccounts } from './subaccounts.js';
import { integrationConnections } from './integrationConnections.js';

export const connectorConfigs = pgTable(
  'connector_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    connectorType: text('connector_type').notNull().$type<'ghl' | 'hubspot' | 'stripe' | 'slack' | 'teamwork' | 'custom'>(),
    connectionId: uuid('connection_id').references(() => integrationConnections.id),
    configJson: jsonb('config_json').$type<Record<string, unknown>>(),
    status: text('status').notNull().default('active').$type<'active' | 'error' | 'disconnected'>(),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSyncStatus: text('last_sync_status'),
    lastSyncError: text('last_sync_error'),
    pollIntervalMinutes: integer('poll_interval_minutes').notNull().default(60),
    webhookSecret: text('webhook_secret'),
    syncPhase: text('sync_phase').notNull().default('backfill').$type<'backfill' | 'transition' | 'live'>(),
    configVersion: text('config_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgConnectorUnique: uniqueIndex('connector_configs_org_type_unique').on(table.organisationId, table.connectorType),
    orgIdx: index('connector_configs_org_idx').on(table.organisationId),
    subaccountIdx: index('connector_configs_subaccount_idx').on(table.subaccountId),
    statusIdx: index('connector_configs_status_idx').on(table.status),
  })
);

export type ConnectorConfig = typeof connectorConfigs.$inferSelect;
export type NewConnectorConfig = typeof connectorConfigs.$inferInsert;
