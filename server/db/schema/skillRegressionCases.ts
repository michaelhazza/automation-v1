import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { skillAmendments } from './skillAmendments';

// ---------------------------------------------------------------------------
// Skill Regression Cases — tracked failures that need a fix.
// Closed-Loop Skill Improvement spec §7.2 (migration 0370).
// ---------------------------------------------------------------------------

export const skillRegressionCases = pgTable(
  'skill_regression_cases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organisations.id),
    amendmentId: uuid('amendment_id').references(() => skillAmendments.id, { onDelete: 'set null' }),
    scorecardJudgementId: uuid('scorecard_judgement_id').notNull(),
    tag: text('tag').notNull().default('unresolved').$type<'unresolved' | 'fix_proposed' | 'fix_wrong'>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('skill_regression_cases_org_idx').on(table.orgId),
    // Partial unique (amendment_id IS NULL) is a SQL partial index in migration
  }),
);

export type SkillRegressionCase = typeof skillRegressionCases.$inferSelect;
export type NewSkillRegressionCase = typeof skillRegressionCases.$inferInsert;
