import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { tasks } from './tasks';

// ---------------------------------------------------------------------------
// routing_outcomes — join table pairing Orchestrator decision records with
// their downstream outcomes for the feedback loop (spec §9.5.2).
// ---------------------------------------------------------------------------

export type RoutingPath = 'A' | 'B' | 'C' | 'D' | 'legacy_fallback' | 'routing_failed' | 'routing_timeout';
export type RoutingOutcome = 'success' | 'partial' | 'failed' | 'user_intervened' | 'abandoned';

export const routingOutcomes = pgTable(
  'routing_outcomes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    decisionRecordId: uuid('decision_record_id').notNull(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    taskId: uuid('task_id').references(() => tasks.id),

    pathTaken: text('path_taken').notNull().$type<RoutingPath>(),
    outcome: text('outcome').notNull().$type<RoutingOutcome>(),

    userInterventionDetail: text('user_intervention_detail'),
    userModifiedAfterCompletion: boolean('user_modified_after_completion').notNull().default(false),
    userModifiedFields: jsonb('user_modified_fields').$type<string[]>(),

    timeToOutcomeMs: integer('time_to_outcome_ms'),
    downstreamErrors: jsonb('downstream_errors').$type<Array<{ stage: string; error: string }>>(),

    capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    decisionRecordUniqueIdx: uniqueIndex('routing_outcomes_decision_record_idx').on(table.decisionRecordId),
    orgCapturedIdx: index('routing_outcomes_org_captured_idx').on(table.organisationId, table.capturedAt),
    pathOutcomeIdx: index('routing_outcomes_path_outcome_idx').on(table.pathTaken, table.outcome),
  })
);

export type RoutingOutcomeRow = typeof routingOutcomes.$inferSelect;
export type NewRoutingOutcomeRow = typeof routingOutcomes.$inferInsert;
