// BYPASSES RLS — every reader MUST be sysadmin-gated at the route/service layer.
// See phase-A-1-2-spec.md §4.3.
import { pgTable, uuid, text, doublePrecision, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const systemMonitorBaselines = pgTable(
  'system_monitor_baselines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    entityKind: text('entity_kind').notNull(),
    entityId: text('entity_id').notNull(),
    metricName: text('metric_name').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    sampleCount: integer('sample_count').notNull().default(0),
    p50: doublePrecision('p50'),
    p95: doublePrecision('p95'),
    p99: doublePrecision('p99'),
    mean: doublePrecision('mean'),
    stddev: doublePrecision('stddev'),
    min: doublePrecision('min'),
    max: doublePrecision('max'),
    entityChangeMarker: text('entity_change_marker'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    entityMetricIdx: uniqueIndex('system_monitor_baselines_entity_metric_idx')
      .on(table.entityKind, table.entityId, table.metricName),
  })
);

export type SystemMonitorBaseline = typeof systemMonitorBaselines.$inferSelect;
export type NewSystemMonitorBaseline = typeof systemMonitorBaselines.$inferInsert;
