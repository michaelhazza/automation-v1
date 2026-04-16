import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
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
    // Preserved for backwards-compat; plural proposedNewAgents is the
    // canonical source going forward (§11 Fix 5).
    agentRecommendation: jsonb('agent_recommendation'),

    // Array of proposed agent entries supporting N-per-job. Entry shape:
    // { proposedAgentIndex, slug, name, description, reasoning, skillSlugs,
    //   status: 'proposed'|'confirmed'|'rejected', confirmedAt?, rejectedAt? }
    // Retro-injected into result.agentProposals so per-skill panels can
    // offer the proposed agent (§11 Fix 5, §11.11.1 coupling).
    proposedNewAgents: jsonb('proposed_new_agents').notNull().default([]),

    // Full skill_analyzer_config row captured at job start. Immutable after
    // INSERT. Validator, collision detector, and Execute guards read from
    // here — never the live config table (§11.11.4 / §11.12.7).
    configSnapshot: jsonb('config_snapshot'),
    // Derived from configSnapshot.config_version; kept for UI display.
    configVersionUsed: integer('config_version_used'),

    // Atomic guard against concurrent Execute. POST /execute acquires via
    // UPDATE … WHERE execution_lock=false; concurrent calls see 409.
    executionLock: boolean('execution_lock').notNull().default(false),
    executionStartedAt: timestamp('execution_started_at', { withTimezone: true }),
    executionFinishedAt: timestamp('execution_finished_at', { withTimezone: true }),

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
