import { pgTable, uuid, text, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { automations } from './automations';
import { integrationConnections } from './integrationConnections';

// ---------------------------------------------------------------------------
// Automation Connection Mappings — wires an automation's required connection
// slots to actual integration connections for a specific subaccount.
// ---------------------------------------------------------------------------

export const automationConnectionMappings = pgTable(
  'automation_connection_mappings',
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
      .references(() => automations.id),
    // Matches a key from automations.required_connections (e.g. "gmail_account")
    connectionKey: text('connection_key').notNull(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    subaccountAutomationKeyUnique: unique('acm_subaccount_automation_key_unique').on(
      table.subaccountId, table.processId, table.connectionKey
    ),
    subaccountAutomationIdx: index('acm_subaccount_automation_idx').on(table.subaccountId, table.processId),
    connectionIdx: index('acm_connection_idx').on(table.connectionId),
    orgIdx: index('acm_org_idx').on(table.organisationId),
  })
);

export type AutomationConnectionMapping = typeof automationConnectionMappings.$inferSelect;
export type NewAutomationConnectionMapping = typeof automationConnectionMappings.$inferInsert;
