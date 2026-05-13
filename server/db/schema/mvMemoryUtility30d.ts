import { pgMaterializedView, uuid, integer, numeric } from 'drizzle-orm/pg-core';

export const mvMemoryUtility30d = pgMaterializedView('mv_memory_utility_30d', {
  organisationId: uuid('organisation_id').notNull(),
  subaccountId: uuid('subaccount_id'), // nullable: NULL = subaccount-less agent (e.g. system agent)
  agentId: uuid('agent_id').notNull(),
  runsMeasuredEntries: integer('runs_measured_entries').notNull(),
  runsUnmeasuredEntries: integer('runs_unmeasured_entries').notNull(),
  // Totals are COALESCE'd to 0 in the SELECT; declare NOT NULL.
  totalInjectedEntries: integer('total_injected_entries').notNull(),
  totalCitedEntries: integer('total_cited_entries').notNull(),
  totalInjectedBlocks: integer('total_injected_blocks').notNull(),
  totalCitedBlocks: integer('total_cited_blocks').notNull(),
  // Ratios remain nullable: NULL = denominator zero = "no signal", never 0.
  entryUtility30d: numeric('entry_utility_30d'),
  blockUtility30d: numeric('block_utility_30d'),
}).existing();
