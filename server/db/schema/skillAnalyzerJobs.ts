import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { users } from './users';

// ---------------------------------------------------------------------------
// Skill Analyzer Jobs — tracks import/analysis sessions (one row per import)
// ---------------------------------------------------------------------------

export interface ClassifyState {
  queue?: string[];                   // slugs entering LLM queue, written once at Stage 5 start
  inFlight?: Record<string, number>;  // slug → startedAtMs (server Date.now())
}

export const skillAnalyzerJobs = pgTable(
  'skill_analyzer_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),

    // Source metadata
    sourceType: text('source_type')
      .notNull()
      .$type<'paste' | 'upload' | 'github' | 'download'>(),
    sourceMetadata: jsonb('source_metadata').notNull().default({}),
    // paste:    { charCount: number }
    // upload:   { fileName: string, fileType: string, fileSize: number }
    // github:   { url: string, branch?: string, path?: string }
    // download: { url: string }

    // Processing state
    status: text('status')
      .notNull()
      .default('pending')
      .$type<'pending' | 'parsing' | 'hashing' | 'embedding' | 'comparing' | 'classifying' | 'completed' | 'failed'>(),
    progressPct: integer('progress_pct').notNull().default(0),
    progressMessage: text('progress_message'),
    errorMessage: text('error_message'),

    // Counts (populated during processing)
    candidateCount: integer('candidate_count'),
    exactDuplicateCount: integer('exact_duplicate_count').default(0),
    comparisonCount: integer('comparison_count').default(0),

    // Raw parsed candidates (JSONB array for replay/debug)
    parsedCandidates: jsonb('parsed_candidates'),

    // Classification state tracking
    classifyState: jsonb('classify_state').$type<ClassifyState>().notNull().default({}),

    // Agent cluster recommendation — populated by Stage 8b after results are
    // written. Shape: { shouldCreateAgent, agentName?, agentSlug?,
    // agentDescription?, reasoning, skillSlugs? }. See migration 0114.
    agentRecommendation: jsonb('agent_recommendation'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index('skill_analyzer_jobs_org_idx').on(table.organisationId),
    activeIdx: index('skill_analyzer_jobs_active_idx').on(table.status),
  })
);

export type SkillAnalyzerJob = typeof skillAnalyzerJobs.$inferSelect;
export type NewSkillAnalyzerJob = typeof skillAnalyzerJobs.$inferInsert;
