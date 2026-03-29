import { pgTable, uuid, text, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';

// ---------------------------------------------------------------------------
// Processed Resources — deduplication log for external inputs across runs
// ---------------------------------------------------------------------------

export const processedResources = pgTable(
  'processed_resources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    integrationType: text('integration_type').notNull(),
    resourceType: text('resource_type').notNull(),
    externalId: text('external_id').notNull(),
    agentId: uuid('agent_id')
      .references(() => agents.id),
    firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
    processedAt: timestamp('processed_at').defaultNow().notNull(),
  },
  (table) => ({
    deduplicationUnique: unique('processed_resources_dedup').on(
      table.subaccountId, table.integrationType, table.resourceType, table.externalId
    ),
    subaccountTypeIdx: index('processed_resources_subaccount_type_idx').on(
      table.subaccountId, table.integrationType, table.resourceType
    ),
  })
);

export type ProcessedResource = typeof processedResources.$inferSelect;
export type NewProcessedResource = typeof processedResources.$inferInsert;
