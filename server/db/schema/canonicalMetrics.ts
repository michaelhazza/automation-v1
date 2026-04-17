import { pgTable, uuid, text, numeric, integer, boolean, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations.js';
import { canonicalAccounts } from './canonicalAccounts.js';
import { users } from './users.js';
import { integrationConnections } from './integrationConnections.js';

// ---------------------------------------------------------------------------
// Canonical Metrics — "latest snapshot" per metric per account
// This table holds the MOST RECENT value only (upsert on unique key).
// Full history is in canonical_metric_history (append-only).
// Intelligence skills read from this table for current state.
// ---------------------------------------------------------------------------

export const canonicalMetrics = pgTable(
  'canonical_metrics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    accountId: uuid('account_id').notNull().references(() => canonicalAccounts.id, { onDelete: 'cascade' }),
    metricSlug: text('metric_slug').notNull(),
    currentValue: numeric('current_value').notNull(),
    previousValue: numeric('previous_value'),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    periodType: text('period_type').notNull(),
    aggregationType: text('aggregation_type').notNull(),
    unit: text('unit'),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
    computationTrigger: text('computation_trigger').notNull().$type<'poll' | 'webhook' | 'manual' | 'scheduled'>(),
    connectorType: text('connector_type').notNull(),
    metricVersion: integer('metric_version').notNull().default(1),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    // P3A: ownership & visibility (migration 0165)
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    visibilityScope: text('visibility_scope').notNull().default('shared_subaccount').$type<'private' | 'shared_team' | 'shared_subaccount' | 'shared_org'>(),
    sharedTeamIds: uuid('shared_team_ids').array().notNull().default(sql`'{}'`),
    sourceConnectionId: uuid('source_connection_id').references(() => integrationConnections.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    accountMetricUnique: uniqueIndex('canonical_metrics_account_metric_unique').on(
      table.accountId, table.metricSlug, table.periodType, table.aggregationType
    ),
    orgMetricIdx: index('canonical_metrics_org_metric_idx').on(table.organisationId, table.metricSlug),
    accountTimeIdx: index('canonical_metrics_account_time_idx').on(table.accountId, table.computedAt),
    // P3A indexes (migration 0165)
    ownerUserIdx: index('canonical_metrics_owner_user_id_idx')
      .on(table.organisationId, table.ownerUserId)
      .where(sql`${table.ownerUserId} IS NOT NULL`),
    sharedTeamGinIdx: index('canonical_metrics_shared_team_gin_idx').using('gin', table.sharedTeamIds),
    sourceConnectionIdx: index('canonical_metrics_source_connection_idx')
      .on(table.sourceConnectionId, table.createdAt)
      .where(sql`${table.sourceConnectionId} IS NOT NULL`),
  })
);

// ---------------------------------------------------------------------------
// Canonical Metric History — append-only record for baseline computation
// ---------------------------------------------------------------------------

export const canonicalMetricHistory = pgTable(
  'canonical_metric_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    accountId: uuid('account_id').notNull().references(() => canonicalAccounts.id, { onDelete: 'cascade' }),
    metricSlug: text('metric_slug').notNull(),
    periodType: text('period_type').notNull(),
    aggregationType: text('aggregation_type').notNull(),
    value: numeric('value').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
    metricVersion: integer('metric_version').notNull().default(1),
    isBackfill: boolean('is_backfill').notNull().default(false),
    // P3A: ownership & visibility (migration 0165)
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    visibilityScope: text('visibility_scope').notNull().default('shared_subaccount').$type<'private' | 'shared_team' | 'shared_subaccount' | 'shared_org'>(),
    sharedTeamIds: uuid('shared_team_ids').array().notNull().default(sql`'{}'`),
    sourceConnectionId: uuid('source_connection_id').references(() => integrationConnections.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    baselineIdx: index('canonical_metric_history_baseline_idx').on(
      table.accountId, table.metricSlug, table.periodType, table.computedAt
    ),
    orgIdx: index('canonical_metric_history_org_idx').on(table.organisationId),
    // Idempotency: prevent duplicate history entries from polling+webhook races
    dedupIdx: uniqueIndex('canonical_metric_history_dedup_idx').on(
      table.accountId, table.metricSlug, table.periodType, table.periodStart, table.periodEnd
    ),
    // P3A indexes (migration 0165)
    ownerUserIdx: index('canonical_metric_history_owner_user_id_idx')
      .on(table.organisationId, table.ownerUserId)
      .where(sql`${table.ownerUserId} IS NOT NULL`),
    sharedTeamGinIdx: index('canonical_metric_history_shared_team_gin_idx').using('gin', table.sharedTeamIds),
    sourceConnectionIdx: index('canonical_metric_history_source_connection_idx')
      .on(table.sourceConnectionId, table.createdAt)
      .where(sql`${table.sourceConnectionId} IS NOT NULL`),
  })
);

export type CanonicalMetric = typeof canonicalMetrics.$inferSelect;
export type NewCanonicalMetric = typeof canonicalMetrics.$inferInsert;
export type CanonicalMetricHistoryEntry = typeof canonicalMetricHistory.$inferSelect;
export type NewCanonicalMetricHistoryEntry = typeof canonicalMetricHistory.$inferInsert;
