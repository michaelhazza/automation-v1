import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Metric Definitions — soft registry for adapter-defined metrics
// Enables template validation and drift detection, not runtime enforcement.
// ---------------------------------------------------------------------------

export const metricDefinitions = pgTable(
  'metric_definitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    metricSlug: text('metric_slug').notNull(),
    connectorType: text('connector_type').notNull(),
    label: text('label'),
    unit: text('unit'), // "percent", "count", "currency", "seconds"
    valueType: text('value_type'), // "ratio", "count", "currency", "duration", "score"
    defaultPeriodType: text('default_period_type'), // "rolling_7d", "rolling_30d"
    defaultAggregationType: text('default_aggregation_type'), // "rate", "ratio", "avg"
    version: integer('version').notNull().default(1),
    status: text('status').notNull().default('active').$type<'active' | 'deprecated' | 'removed'>(),
    dependsOn: jsonb('depends_on').$type<string[]>(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    connectorSlugUnique: uniqueIndex('metric_definitions_connector_slug_unique').on(
      table.connectorType, table.metricSlug
    ),
  })
);

export type MetricDefinition = typeof metricDefinitions.$inferSelect;
export type NewMetricDefinition = typeof metricDefinitions.$inferInsert;
