import { pgTable, uuid, integer, boolean, doublePrecision, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { skillAmendments } from './skillAmendments';

// ---------------------------------------------------------------------------
// Skill Amendment Effectiveness — sidecar metrics per accepted amendment.
// Closed-Loop Skill Improvement spec §7.4 (migration 0370).
// org_id is required for RLS tenant isolation (canonical org-isolation pattern).
// ---------------------------------------------------------------------------

export const skillAmendmentEffectiveness = pgTable(
  'skill_amendment_effectiveness',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    amendmentId: uuid('amendment_id').notNull().references(() => skillAmendments.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organisations.id),
    regressionsPrevented: integer('regressions_prevented').notNull().default(0),
    subsequentFailRateDelta: doublePrecision('subsequent_fail_rate_delta'),
    operatorOverrideFrequency: doublePrecision('operator_override_frequency'),
    inactivityDecayCandidate: boolean('inactivity_decay_candidate').notNull().default(false),
    lastReplayRunAt: timestamp('last_replay_run_at', { withTimezone: true }),
    lastReplayVerdict: text('last_replay_verdict'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    amendmentUniq: unique('skill_amendment_effectiveness_amendment_uniq').on(table.amendmentId),
  }),
);

export type SkillAmendmentEffectiveness = typeof skillAmendmentEffectiveness.$inferSelect;
export type NewSkillAmendmentEffectiveness = typeof skillAmendmentEffectiveness.$inferInsert;
