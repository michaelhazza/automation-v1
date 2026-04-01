import { pgTable, uuid, text, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { processes } from './processes';
import { integrationConnections } from './integrationConnections';

// ---------------------------------------------------------------------------
// Process Connection Mappings — wires a process's required connection slots
// to actual integration connections for a specific subaccount.
// ---------------------------------------------------------------------------

export const processConnectionMappings = pgTable(
  'process_connection_mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    processId: uuid('process_id')
      .notNull()
      .references(() => processes.id),
    // Matches a key from processes.required_connections (e.g. "gmail_account")
    connectionKey: text('connection_key').notNull(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    subaccountProcessKeyUnique: unique('pcm_subaccount_process_key_unique').on(
      table.subaccountId, table.processId, table.connectionKey
    ),
    subaccountProcessIdx: index('pcm_subaccount_process_idx').on(table.subaccountId, table.processId),
    connectionIdx: index('pcm_connection_idx').on(table.connectionId),
    orgIdx: index('pcm_org_idx').on(table.organisationId),
  })
);

export type ProcessConnectionMapping = typeof processConnectionMappings.$inferSelect;
export type NewProcessConnectionMapping = typeof processConnectionMappings.$inferInsert;
