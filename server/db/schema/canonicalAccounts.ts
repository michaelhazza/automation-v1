import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { connectorConfigs } from './connectorConfigs.js';
import { subaccounts } from './subaccounts.js';

export const canonicalAccounts = pgTable(
  'canonical_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    connectorConfigId: uuid('connector_config_id').notNull().references(() => connectorConfigs.id, { onDelete: 'cascade' }),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    externalId: text('external_id').notNull(),
    displayName: text('display_name'),
    status: text('status').notNull().default('active').$type<'active' | 'inactive' | 'suspended'>(),
    externalMetadata: jsonb('external_metadata').$type<Record<string, unknown>>(),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    connectorExternalUnique: uniqueIndex('canonical_accounts_connector_external_unique').on(table.connectorConfigId, table.externalId),
    orgIdx: index('canonical_accounts_org_idx').on(table.organisationId),
    connectorIdx: index('canonical_accounts_connector_idx').on(table.connectorConfigId),
    subaccountIdx: index('canonical_accounts_subaccount_idx').on(table.subaccountId),
  })
);

export type CanonicalAccount = typeof canonicalAccounts.$inferSelect;
export type NewCanonicalAccount = typeof canonicalAccounts.$inferInsert;
