import { pgTable, uuid, text, numeric, integer, boolean, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { canonicalAccounts } from './canonicalAccounts.js';

// ---------------------------------------------------------------------------
// Canonical Metrics — derived metrics computed by adapters from raw entities
// Intelligence skills read from this table, never from raw entity tables.
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
    periodType: text('period_type').notNull(), // "rolling_7d", "rolling_30d", "daily", "hourly"
    aggregationType: text('aggregation_type').notNull(), // "rate", "ratio", "count", "avg", "sum"
    unit: text('unit'), // "percent", "count", "currency", "seconds"
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
    computationTrigger: text('computation_trigger').notNull().$type<'poll' | 'webhook' | 'manual' | 'scheduled'>(),
    connectorType: text('connector_type').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    accountMetricUnique: uniqueIndex('canonical_metrics_account_metric_unique').on(
      table.accountId, table.metricSlug, table.periodType, table.aggregationType
    ),
    orgMetricIdx: index('canonical_metrics_org_metric_idx').on(table.organisationId, table.metricSlug),
    accountTimeIdx: index('canonical_metrics_account_time_idx').on(table.accountId, table.computedAt),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    baselineIdx: index('canonical_metric_history_baseline_idx').on(
      table.accountId, table.metricSlug, table.periodType, table.computedAt
    ),
    orgIdx: index('canonical_metric_history_org_idx').on(table.organisationId),
  })
);

export type CanonicalMetric = typeof canonicalMetrics.$inferSelect;
export type NewCanonicalMetric = typeof canonicalMetrics.$inferInsert;
export type CanonicalMetricHistoryEntry = typeof canonicalMetricHistory.$inferSelect;
export type NewCanonicalMetricHistoryEntry = typeof canonicalMetricHistory.$inferInsert;
