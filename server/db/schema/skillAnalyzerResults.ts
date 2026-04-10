import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { skillAnalyzerJobs } from './skillAnalyzerJobs';
import { users } from './users';

// ---------------------------------------------------------------------------
// Skill Analyzer Results — one row per candidate-to-library comparison
// ---------------------------------------------------------------------------

export const skillAnalyzerResults = pgTable(
  'skill_analyzer_results',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => skillAnalyzerJobs.id, { onDelete: 'cascade' }),

    // Candidate skill identity
    candidateIndex: integer('candidate_index').notNull(),
    candidateName: text('candidate_name').notNull(),
    candidateSlug: text('candidate_slug').notNull(),

    // Matched existing skill (null for DISTINCT)
    matchedSkillId: uuid('matched_skill_id'),
    matchedSystemSkillSlug: text('matched_system_skill_slug'),
    matchedSkillName: text('matched_skill_name'),

    // Classification output
    classification: text('classification')
      .notNull()
      .$type<'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT'>(),
    confidence: real('confidence').notNull(),
    similarityScore: real('similarity_score'),
    classificationReasoning: text('classification_reasoning'),

    // Diff data for side-by-side UI
    diffSummary: jsonb('diff_summary'),

    // User action
    actionTaken: text('action_taken')
      .$type<'approved' | 'rejected' | 'skipped'>(),
    actionTakenAt: timestamp('action_taken_at', { withTimezone: true }),
    actionTakenBy: uuid('action_taken_by')
      .references(() => users.id),

    // Execution outcome
    executionResult: text('execution_result')
      .$type<'created' | 'updated' | 'skipped' | 'failed'>(),
    executionError: text('execution_error'),
    resultingSkillId: uuid('resulting_skill_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    jobIdx: index('skill_analyzer_results_job_idx').on(table.jobId),
    classificationIdx: index('skill_analyzer_results_classification_idx').on(
      table.jobId,
      table.classification
    ),
  })
);

export type SkillAnalyzerResult = typeof skillAnalyzerResults.$inferSelect;
export type NewSkillAnalyzerResult = typeof skillAnalyzerResults.$inferInsert;
