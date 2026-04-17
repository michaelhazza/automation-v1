import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations.js';
import { connectorConfigs } from './connectorConfigs.js';
import { subaccounts } from './subaccounts.js';
import { users } from './users.js';
import { integrationConnections } from './integrationConnections.js';

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
    // P3A: ownership & visibility (migration 0165)
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    visibilityScope: text('visibility_scope').notNull().default('shared_subaccount').$type<'private' | 'shared_team' | 'shared_subaccount' | 'shared_org'>(),
    sharedTeamIds: uuid('shared_team_ids').array().notNull().default(sql`'{}'`),
    sourceConnectionId: uuid('source_connection_id').references(() => integrationConnections.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    connectorExternalUnique: uniqueIndex('canonical_accounts_connector_external_unique').on(table.connectorConfigId, table.externalId),
    orgIdx: index('canonical_accounts_org_idx').on(table.organisationId),
    connectorIdx: index('canonical_accounts_connector_idx').on(table.connectorConfigId),
    subaccountIdx: index('canonical_accounts_subaccount_idx').on(table.subaccountId),
    // P3A indexes (migration 0165)
    ownerUserIdx: index('canonical_accounts_owner_user_id_idx')
      .on(table.organisationId, table.ownerUserId)
      .where(sql`${table.ownerUserId} IS NOT NULL`),
    sharedTeamGinIdx: index('canonical_accounts_shared_team_gin_idx').using('gin', table.sharedTeamIds),
    sourceConnectionIdx: index('canonical_accounts_source_connection_idx')
      .on(table.sourceConnectionId, table.createdAt)
      .where(sql`${table.sourceConnectionId} IS NOT NULL`),
  })
);

export type CanonicalAccount = typeof canonicalAccounts.$inferSelect;
export type NewCanonicalAccount = typeof canonicalAccounts.$inferInsert;
