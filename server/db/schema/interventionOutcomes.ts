import { pgTable, uuid, text, integer, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { canonicalAccounts } from './canonicalAccounts.js';

// ---------------------------------------------------------------------------
// Intervention Outcomes — tracks effectiveness of interventions
// ---------------------------------------------------------------------------

export const interventionOutcomes = pgTable(
  'intervention_outcomes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    interventionId: uuid('intervention_id').notNull(), // references actions or review_items
    accountId: uuid('account_id').notNull().references(() => canonicalAccounts.id, { onDelete: 'cascade' }),
    interventionTypeSlug: text('intervention_type_slug').notNull(),
    triggerEventId: uuid('trigger_event_id'), // anomaly or alert that triggered this
    runId: uuid('run_id'), // agent run that generated the decision
    configVersion: text('config_version'), // config version at decision time
    healthScoreBefore: integer('health_score_before'),
    healthScoreAfter: integer('health_score_after'),
    outcome: text('outcome').$type<'improved' | 'unchanged' | 'worsened'>(),
    measuredAfterHours: integer('measured_after_hours').notNull().default(24),
    deltaHealthScore: integer('delta_health_score'),
    // Phase 4 — band-change attribution for B2 (migration 0178).
    bandBefore: text('band_before'),
    bandAfter: text('band_after'),
    bandChanged: boolean('band_changed').notNull().default(false),
    executionFailed: boolean('execution_failed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('intervention_outcomes_org_idx').on(table.organisationId),
    accountIdx: index('intervention_outcomes_account_idx').on(table.accountId),
    interventionUnique: uniqueIndex('intervention_outcomes_intervention_unique').on(table.interventionId),
  })
);

export type InterventionOutcome = typeof interventionOutcomes.$inferSelect;
export type NewInterventionOutcome = typeof interventionOutcomes.$inferInsert;
