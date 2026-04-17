import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { integrationConnections } from './integrationConnections.js';

// ---------------------------------------------------------------------------
// Integration Ingestion Stats — per-sync metrics for integration connectors.
// One row per sync execution; used for observability, cost attribution,
// and backfill-vs-live phase tracking.
// ---------------------------------------------------------------------------

export const integrationIngestionStats = pgTable(
  'integration_ingestion_stats',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    syncStartedAt: timestamp('sync_started_at', { withTimezone: true }).notNull(),
    syncFinishedAt: timestamp('sync_finished_at', { withTimezone: true }),
    apiCallsApprox: integer('api_calls_approx').notNull().default(0),
    rowsIngested: integer('rows_ingested').notNull().default(0),
    syncDurationMs: integer('sync_duration_ms'),
    syncPhase: text('sync_phase').notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    connectionIdx: index('integration_ingestion_stats_connection_idx').on(
      table.connectionId, table.syncStartedAt
    ),
    orgIdx: index('integration_ingestion_stats_org_idx').on(
      table.organisationId, table.createdAt
    ),
    dedupIdx: uniqueIndex('integration_ingestion_stats_dedup_idx').on(
      table.connectionId, table.syncStartedAt
    ),
  })
);

export type IntegrationIngestionStat = typeof integrationIngestionStats.$inferSelect;
export type NewIntegrationIngestionStat = typeof integrationIngestionStats.$inferInsert;
