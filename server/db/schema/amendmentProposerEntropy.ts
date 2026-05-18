import { pgTable, uuid, text, date, doublePrecision, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';

// ---------------------------------------------------------------------------
// Amendment Proposer Entropy — per-org per-skill per-month diversity metrics.
// skill_id is text to accommodate both system and org skill slugs.
// period_month is the first day of the month (date type).
// Closed-Loop Skill Improvement spec §7.6 (migration 0370).
// ---------------------------------------------------------------------------

export const amendmentProposerEntropy = pgTable(
  'amendment_proposer_entropy',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organisations.id),
    skillId: text('skill_id').notNull(),
    periodMonth: date('period_month').notNull(),
    templateRepetitionRate: doublePrecision('template_repetition_rate'),
    lexicalDiversity: doublePrecision('lexical_diversity'),
    remedyCategoryDistribution: jsonb('remedy_category_distribution'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgSkillMonthUniq: unique('amendment_proposer_entropy_org_skill_month_uniq').on(
      table.orgId,
      table.skillId,
      table.periodMonth,
    ),
  }),
);

export type AmendmentProposerEntropy = typeof amendmentProposerEntropy.$inferSelect;
export type NewAmendmentProposerEntropy = typeof amendmentProposerEntropy.$inferInsert;
