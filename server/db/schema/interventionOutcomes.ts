import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
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
    healthScoreBefore: integer('health_score_before'),
    healthScoreAfter: integer('health_score_after'),
    outcome: text('outcome').$type<'improved' | 'unchanged' | 'worsened'>(),
    measuredAfterHours: integer('measured_after_hours').notNull().default(24),
    deltaHealthScore: integer('delta_health_score'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('intervention_outcomes_org_idx').on(table.organisationId),
    accountIdx: index('intervention_outcomes_account_idx').on(table.accountId),
    interventionIdx: index('intervention_outcomes_intervention_idx').on(table.interventionId),
  })
);

export type InterventionOutcome = typeof interventionOutcomes.$inferSelect;
export type NewInterventionOutcome = typeof interventionOutcomes.$inferInsert;
