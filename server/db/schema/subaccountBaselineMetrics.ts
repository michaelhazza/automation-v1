import { pgTable, uuid, text, jsonb, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';
import { subaccountBaselines } from './subaccountBaselines.js';

export type MetricSource = 'canonical_metric' | 'manual' | 'unavailable';

/** JSONB shape stored in subaccount_baseline_metrics.value. */
export interface MetricValue {
  numeric: number;
  currency?: string;  // e.g. 'USD', set when unit is a currency
  unit: string;       // 'cents', 'count', 'percent'
}

export const subaccountBaselineMetrics = pgTable(
  'subaccount_baseline_metrics',
  {
    baselineId: uuid('baseline_id').notNull().references(() => subaccountBaselines.id, { onDelete: 'cascade' }),
    metricSlug: text('metric_slug').notNull(),
    value: jsonb('value').notNull().$type<MetricValue>(),
    source: text('source').notNull().$type<MetricSource>(),
    unavailableReason: text('unavailable_reason'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.baselineId, table.metricSlug] }),
    slugIdx: index('subaccount_baseline_metrics_slug_idx').on(table.metricSlug),
  }),
);

export type SubaccountBaselineMetric = typeof subaccountBaselineMetrics.$inferSelect;
export type NewSubaccountBaselineMetric = typeof subaccountBaselineMetrics.$inferInsert;
