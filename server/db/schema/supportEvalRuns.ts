import { pgTable, uuid, text, jsonb, numeric, integer, timestamp, boolean, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';

// ---------------------------------------------------------------------------
// support_eval_runs — Support Agent eval harness result records (spec §5.5.1)
//
// One row per daily eval run per organisation. Stores classification accuracy
// per intent, judge score averages, thresholds used, model/prompt version,
// and skill template hashes for drift detection.
//
// INV-5: additive new table only
// INV-6: RLS enabled (migration 0315)
// ---------------------------------------------------------------------------

export const supportEvalRuns = pgTable(
  'support_eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    classificationAccuracyPerIntent: jsonb('classification_accuracy_per_intent')
      .notNull()
      .$type<Record<string, number>>(),
    draftJudgeScoreAvg: numeric('draft_judge_score_avg', { precision: 4, scale: 2 }).notNull(),
    thresholdClassificationMin: numeric('threshold_classification_min', { precision: 4, scale: 2 }).notNull(),
    thresholdJudgeMin: numeric('threshold_judge_min', { precision: 4, scale: 2 }).notNull(),
    promptVersion: integer('prompt_version').notNull(),
    modelId: text('model_id').notNull(),
    skillTemplateHashes: jsonb('skill_template_hashes')
      .notNull()
      .$type<Record<string, string>>(),
    rowCount: integer('row_count').notNull(),
    partial: boolean('partial').notNull().default(false),
  },
  (table) => ({
    orgRunAtIdx: index('support_eval_runs_org_run_at_idx').on(table.organisationId, table.runAt),
  }),
);

export type SupportEvalRun = typeof supportEvalRuns.$inferSelect;
export type NewSupportEvalRun = typeof supportEvalRuns.$inferInsert;
