// BYPASSES RLS — every reader MUST be sysadmin-gated at the route/service layer.
// See phase-A-1-2-spec.md §4.3.
import { pgTable, uuid, text, doublePrecision, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { systemIncidents } from './systemIncidents.js';

export const systemMonitorHeuristicFires = pgTable(
  'system_monitor_heuristic_fires',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    heuristicId: text('heuristic_id').notNull(),
    firedAt: timestamp('fired_at', { withTimezone: true }).defaultNow().notNull(),
    entityKind: text('entity_kind').notNull(),
    entityId: text('entity_id').notNull(),
    evidenceRunId: uuid('evidence_run_id'),
    confidence: doublePrecision('confidence'),
    metadata: jsonb('metadata'),
    producedIncidentId: uuid('produced_incident_id').references(() => systemIncidents.id, { onDelete: 'set null' }),
  },
  (table) => ({
    entityIdx: index('system_monitor_heuristic_fires_entity_idx')
      .on(table.entityKind, table.entityId, table.firedAt),
    heuristicIdx: index('system_monitor_heuristic_fires_heuristic_idx')
      .on(table.heuristicId, table.firedAt),
  })
);

export type SystemMonitorHeuristicFire = typeof systemMonitorHeuristicFires.$inferSelect;
export type NewSystemMonitorHeuristicFire = typeof systemMonitorHeuristicFires.$inferInsert;
