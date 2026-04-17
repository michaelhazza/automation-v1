import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  jsonb,
  boolean,
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
    // SHA-256 of the candidate's normalized content, computed during the
    // Hash stage and persisted here so the Phase 4 manual-add PATCH can
    // look up the candidate embedding in skill_embeddings without
    // recomputing it. See spec §5.2 / §6 Write stage.
    candidateContentHash: text('candidate_content_hash').notNull(),

    // Matched existing skill (null for DISTINCT). Re-points at system_skills.id
    // after Phase 1 — the analyzer is system-only. Soft FK (no constraint)
    // because the analyzer uses it as a lookup hint. Legacy
    // matched_system_skill_slug and matched_skill_name columns dropped in
    // migration 0098 — matchedSkillContent is computed live in getJob().
    matchedSkillId: uuid('matched_skill_id'),

    // Classification output
    classification: text('classification')
      .notNull()
      .$type<'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT'>(),
    confidence: real('confidence').notNull(),
    similarityScore: real('similarity_score'),
    classificationReasoning: text('classification_reasoning'),
    // Tracks API-level failure during the classify stage. True only when the
    // LLM call failed (429, parse error) — NOT set for genuine PARTIAL_OVERLAP
    // results. Used to distinguish retryable failures from model output.
    classificationFailed: boolean('classification_failed').notNull().default(false),
    // Reason for the failure: 'rate_limit' | 'parse_error' | 'timed_out' | 'unknown'.
    // Null on all rows where classificationFailed is false.
    classificationFailureReason: text('classification_failure_reason'),

    // Diff data for side-by-side UI
    diffSummary: jsonb('diff_summary'),

    // Agent attachment proposals — populated only for DISTINCT results.
    // Shape: Array<{ systemAgentId: uuid, slugSnapshot: string,
    // nameSnapshot: string, score: number, selected: boolean,
    // llmReasoning?: string, llmConfirmed?: boolean }>. See spec §5.2 and
    // migration 0114 (Stage 7b enrichment).
    agentProposals: jsonb('agent_proposals').notNull().default([]),

    // Non-skill file detection flags — set during Stage 4b heuristic scan.
    // isDocumentationFile: README-style, no tool definition, repo-name slug.
    // isContextFile: no tool definition but has description + instructions
    //   (e.g. foundation skill docs like product-marketing-context).
    // See migration 0114.
    isDocumentationFile: boolean('is_documentation_file').notNull().default(false),
    isContextFile: boolean('is_context_file').notNull().default(false),

    // LLM-generated merge proposal for PARTIAL_OVERLAP / IMPROVEMENT results.
    // Shape: { name, description, definition: object, instructions: string|null }.
    // Editable via PATCH; see spec §7.3 merge endpoint.
    proposedMergedContent: jsonb('proposed_merged_content'),
    // The LLM's untouched original — Reset endpoint copies this back into
    // proposedMergedContent. Immutable after the Write stage.
    originalProposedMerge: jsonb('original_proposed_merge'),
    // Set true when the user edits any field in proposedMergedContent.
    userEditedMerge: boolean('user_edited_merge').notNull().default(false),

    // LLM-generated merge rationale (Bug 6). Null for DUPLICATE/DISTINCT or
    // when the LLM omits the field. Read-only after the job writes it.
    mergeRationale: text('merge_rationale'),

    // Structured warnings from the post-processing validator (Bugs 1,2,3,4,7,8,10).
    // Null when no warnings raised or classification is DUPLICATE/DISTINCT.
    mergeWarnings: jsonb('merge_warnings'),

    // v2 fixes — see migration 0155.
    // Reviewer decisions per warning, deduped by (warningCode, details.field).
    // Each entry: { warningCode, resolution, resolvedAt, resolvedBy, details? }.
    // Wiped atomically on any merge edit or reset.
    warningResolutions: jsonb('warning_resolutions').notNull().default([]),
    // True when the rule-based fallback merger produced proposedMergedContent
    // (classifier unavailable or LLM parse failure).
    classifierFallbackApplied: boolean('classifier_fallback_applied').notNull().default(false),
    // Canonical skill name chosen via NAME_MISMATCH resolution. When set,
    // Execute uses this over any drift in proposedMergedContent.name.
    executionResolvedName: text('execution_resolved_name'),

    // User action
    actionTaken: text('action_taken')
      .$type<'approved' | 'rejected' | 'skipped'>(),
    actionTakenAt: timestamp('action_taken_at', { withTimezone: true }),
    actionTakenBy: uuid('action_taken_by')
      .references(() => users.id),
    // Set on approve; presence locks the row against merge / resolution edits.
    // Cleared on unapprove (action=null).
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    // Snapshot of evaluateApprovalState result at approve time (debug trace).
    approvalDecisionSnapshot: jsonb('approval_decision_snapshot'),
    // sha256 of stable-stringified approval_decision_snapshot. Compared at
    // Execute to surface drift (§11.12.1, non-blocking).
    approvalHash: text('approval_hash'),
    // Set true on first approval; never reset. UI surfaces "modified after
    // previous approval" badge on unapprove→edit→re-approve cycles.
    wasApprovedBefore: boolean('was_approved_before').notNull().default(false),

    // Optimistic concurrency for merge edits — set by patchMergeFields and
    // resetMergeToOriginal. Null on rows that have never been merge-edited.
    // The PATCH /merge endpoint accepts an optional ifUnmodifiedSince value and
    // rejects with 409 when this column is newer than the client's copy.
    mergeUpdatedAt: timestamp('merge_updated_at', { withTimezone: true }),

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
