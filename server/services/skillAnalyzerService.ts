import { eq, and, sql, isNull } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { db } from '../db/index.js';
import type { AgentRecommendation, WarningTier, SkillAnalyzerJobStatus } from './skillAnalyzerServicePure.js';
import type { ClassifyState } from '../db/schema/skillAnalyzerJobs.js';
import * as skillAnalyzerConfigService from './skillAnalyzerConfigService.js';
import { slugifyName } from './skillAnalyzerService/helpers/slugify.js';
import { skillAnalyzerJobs, skillAnalyzerResults } from '../db/schema/index.js';
import { createJob } from './skillAnalyzerService/jobLifecycle/create.js';
import { resumeJob, RESUME_MID_FLIGHT_GHOST_THRESHOLD_MS } from './skillAnalyzerService/jobLifecycle/resume.js';
import { getJob, getJobById, listJobs } from './skillAnalyzerService/jobLifecycle/get.js';
import { setResultAction, bulkSetResultAction } from './skillAnalyzerService/results/setAction.js';
import { updateProposedAgent, updateAgentProposal, updateResultAgentProposals } from './skillAnalyzerService/results/updateProposal.js';
import { resolveWarning, appendBatchCollisionWarnings, applyBatchDeductionAndWarningAtomic } from './skillAnalyzerService/results/warnings.js';
import { patchMergeFields, resetMergeToOriginal } from './skillAnalyzerService/results/merge.js';
import { executeApproved } from './skillAnalyzerService/execute/approved.js';
import { retryClassification, bulkRetryFailedClassifications } from './skillAnalyzerService/execute/retry.js';
import { unlockStaleExecution } from './skillAnalyzerService/execute/unlock.js';

// ---------------------------------------------------------------------------
// Skill Analyzer Service — CRUD for jobs/results + pipeline orchestration
// ---------------------------------------------------------------------------

// Status union is defined once in skillAnalyzerServicePure.ts alongside the
// mid-flight and terminal subsets. Re-export here so existing callers keep
// their import path.
export {
  SKILL_ANALYZER_JOB_STATUSES,
  SKILL_ANALYZER_MID_FLIGHT_STATUSES,
  SKILL_ANALYZER_TERMINAL_STATUSES,
  isSkillAnalyzerTerminalStatus,
  isSkillAnalyzerMidFlightStatus,
  type SkillAnalyzerJobStatus,
  type SkillAnalyzerMidFlightStatus,
  type SkillAnalyzerTerminalStatus,
} from './skillAnalyzerServicePure.js';

export { createJob };
export { resumeJob, RESUME_MID_FLIGHT_GHOST_THRESHOLD_MS };
export { getJob, getJobById, listJobs };

export type { MatchedSkillContent, AvailableSystemAgent, EnrichedResult, GetJobResponse, ResolveWarningParams, UpdateAgentProposalParams, PatchMergeFieldsParams } from './skillAnalyzerService/types.js';

export { setResultAction, bulkSetResultAction };
export { updateProposedAgent, updateAgentProposal, updateResultAgentProposals };
export { resolveWarning, appendBatchCollisionWarnings, applyBatchDeductionAndWarningAtomic };
export { patchMergeFields, resetMergeToOriginal };

export { executeApproved } from './skillAnalyzerService/execute/approved.js';
export { retryClassification, bulkRetryFailedClassifications } from './skillAnalyzerService/execute/retry.js';
export { unlockStaleExecution } from './skillAnalyzerService/execute/unlock.js';

/** Update job progress (used by the job handler). */
export async function updateJobProgress(
  jobId: string,
  update: {
    status?: SkillAnalyzerJobStatus;
    progressPct?: number;
    progressMessage?: string;
    errorMessage?: string;
    candidateCount?: number;
    exactDuplicateCount?: number;
    comparisonCount?: number;
    parsedCandidates?: unknown;
    completedAt?: Date;
    classifyState?: ClassifyState;
  }
): Promise<void> {
  type JobUpdate = typeof skillAnalyzerJobs.$inferInsert;
  const values: Partial<JobUpdate> = { updatedAt: new Date() };
  if (update.status !== undefined) values.status = update.status;
  if (update.progressPct !== undefined) values.progressPct = update.progressPct;
  if (update.progressMessage !== undefined) values.progressMessage = update.progressMessage;
  if (update.errorMessage !== undefined) values.errorMessage = update.errorMessage;
  if (update.candidateCount !== undefined) values.candidateCount = update.candidateCount;
  if (update.exactDuplicateCount !== undefined) values.exactDuplicateCount = update.exactDuplicateCount;
  if (update.comparisonCount !== undefined) values.comparisonCount = update.comparisonCount;
  if (update.parsedCandidates !== undefined) values.parsedCandidates = update.parsedCandidates as JobUpdate['parsedCandidates'];
  if (update.completedAt !== undefined) values.completedAt = update.completedAt;
  if (update.classifyState !== undefined) values.classifyState = update.classifyState;

  await db
    .update(skillAnalyzerJobs)
    .set(values)
    .where(eq(skillAnalyzerJobs.id, jobId));
}

// ---------------------------------------------------------------------------
// Internal functions for job handler use (no org-scoping — admin bypass path)
// ---------------------------------------------------------------------------

/** Batch insert results for a job. Splits into 100-row batches. */
export async function insertResults(
  rows: (typeof skillAnalyzerResults.$inferInsert)[]
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 100) {
    await db.insert(skillAnalyzerResults).values(rows.slice(i, i + 100));
  }
}

/** Insert a single result row for a job. */
export async function insertSingleResult(
  row: typeof skillAnalyzerResults.$inferInsert,
): Promise<void> {
  await db.insert(skillAnalyzerResults).values(row);
}

/** List already-written result rows for a job as a minimal projection.
 *  Returned for crash-resume in Stage 5: the job handler re-invokes after a
 *  worker crash, and any candidate_index already present in this list has had
 *  its LLM classification paid for and persisted — we must not re-call the
 *  provider for it. Only the fields downstream stages actually read are
 *  selected (candidateIndex + classification drive Stage 7 agent-propose and
 *  Stage 8 agent-proposal backfill).
 *
 *  Deduplicated by candidateIndex at the query boundary because
 *  skill_analyzer_results has no UNIQUE(job_id, candidate_index) constraint.
 *  Pre-PR (when Stage 1 called clearResultsForJob on every retry) a single
 *  jobId could end up with two rows for the same index; callers that iterate
 *  this list must see each index exactly once so downstream reconstruction
 *  produces a single deterministic classifiedResults entry per candidate.
 *
 *  Ordering matters for determinism. We sort by candidate_index ASC, then
 *  created_at DESC, then id DESC as a final tiebreaker — the first row
 *  encountered for each candidate_index wins, so "latest write wins" semantics
 *  apply. Without ORDER BY, Postgres returns rows in storage order, which is
 *  not stable across vacuum / hot-update boundaries and can flip the chosen
 *  row between runs. */
export async function listResultIndicesForJob(
  jobId: string,
): Promise<Array<{
  candidateIndex: number;
  classification: 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';
  matchedSkillId: string | null;
  proposedMergedName: string | null;
  proposedMergedInstructions: string | null;
}>> {
  // Raw SQL used to extract JSONB sub-fields without pulling the full JSONB blob.
  const rawRows = await db.execute(sql`
    SELECT
      candidate_index        AS "candidateIndex",
      classification,
      matched_skill_id       AS "matchedSkillId",
      proposed_merged_content->>'name'         AS "proposedMergedName",
      proposed_merged_content->>'instructions' AS "proposedMergedInstructions"
    FROM skill_analyzer_results
    WHERE job_id = ${jobId}
    ORDER BY candidate_index ASC, created_at DESC, id DESC
  `);

  type RawRow = {
    candidateIndex: number;
    classification: 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';
    matchedSkillId: string | null;
    proposedMergedName: string | null;
    proposedMergedInstructions: string | null;
  };

  const seen = new Set<number>();
  const deduped: RawRow[] = [];
  for (const row of rawRows as unknown as RawRow[]) {
    if (seen.has(row.candidateIndex)) continue;
    seen.add(row.candidateIndex);
    deduped.push(row);
  }
  return deduped;
}

/** Record that a slug's LLM classification is in-flight.
 *  Writes startedAtMs into classify_state.inFlight[slug] via a JSONB merge.
 *  The slug is a parameterized bind value — no sql.raw, injection-safe. */
export async function markSkillInFlight(
  jobId: string,
  slug: string,
  startedAtMs: number,
): Promise<void> {
  await db
    .update(skillAnalyzerJobs)
    .set({
      classifyState: sql`jsonb_set(
        coalesce(classify_state, '{}'),
        ARRAY['inFlight', ${slug}]::text[],
        ${String(startedAtMs)}::jsonb
      )`,
      updatedAt: new Date(),
    })
    .where(eq(skillAnalyzerJobs.id, jobId));
}

/** Remove a slug from classify_state.inFlight once classification completes. */
export async function unmarkSkillInFlight(
  jobId: string,
  slug: string,
): Promise<void> {
  await db
    .update(skillAnalyzerJobs)
    .set({
      classifyState: sql`coalesce(classify_state, '{}') #- ARRAY['inFlight', ${slug}]::text[]`,
      updatedAt: new Date(),
    })
    .where(eq(skillAnalyzerJobs.id, jobId));
}

/** Persist the cluster-level agent recommendation on the job row.
 *  Written by Stage 8b after all per-skill proposals are finalised.
 *  Idempotent: no-op if a recommendation is already stored (job retry safety).
 *  Validates minimum shape before writing to prevent corrupt JSONB. */
export async function updateJobAgentRecommendation(
  jobId: string,
  recommendation: AgentRecommendation,
): Promise<void> {
  // Minimal shape guard — shouldCreateAgent must be boolean, reasoning non-empty string,
  // skillSlugs must be an array when present (UI calls .map() on it).
  if (typeof recommendation.shouldCreateAgent !== 'boolean') {
    throw new Error('updateJobAgentRecommendation: shouldCreateAgent must be boolean');
  }
  if (typeof recommendation.reasoning !== 'string' || recommendation.reasoning.trim() === '') {
    throw new Error('updateJobAgentRecommendation: reasoning must be a non-empty string');
  }
  if (recommendation.skillSlugs !== undefined && !Array.isArray(recommendation.skillSlugs)) {
    throw new Error('updateJobAgentRecommendation: skillSlugs must be an array if present');
  }

  // v2 Fix 5: also write the proposedNewAgents array. Single-agent case today;
  // shape supports N entries per job.
  const proposedNewAgents = recommendation.shouldCreateAgent
    ? [{
        proposedAgentIndex: 0,
        slug: recommendation.agentSlug ?? slugifyName(recommendation.agentName ?? 'proposed-agent'),
        name: recommendation.agentName ?? 'Proposed Agent',
        description: recommendation.agentDescription ?? recommendation.reasoning,
        reasoning: recommendation.reasoning,
        skillSlugs: Array.isArray(recommendation.skillSlugs) ? recommendation.skillSlugs : [],
        status: 'proposed' as const,
      }]
    : [];

  // Idempotency: only write if the column is still null (first run wins on retry).
  const updated = await db
    .update(skillAnalyzerJobs)
    .set({
      agentRecommendation: recommendation,
      proposedNewAgents,
    })
    .where(and(eq(skillAnalyzerJobs.id, jobId), isNull(skillAnalyzerJobs.agentRecommendation)))
    .returning({ id: skillAnalyzerJobs.id });

  if (updated.length === 0) {
    // Row was skipped — recommendation already written on a previous run.
    // Do NOT return early: the retro-inject below must still run. On resumed
    // or re-triggered jobs the agentRecommendation column is already set
    // (idempotency guard blocks the write) but the per-result agentProposals
    // may be empty if the inject was missed on a prior run (e.g. before Fix 5
    // was deployed, or if the inject was aborted mid-loop). The per-row
    // duplicate guard at line ~2123 prevents double-injection.
    logger.info('skill_analyzer_agent_recommendation_already_exists', { jobId });
  }

  // Retro-inject synthetic proposed-new-agent entries into affected
  // DISTINCT results' agentProposals so per-skill assignment panels can
  // show the proposed agent. Only runs when a new agent was suggested.
  if (recommendation.shouldCreateAgent && Array.isArray(recommendation.skillSlugs) && recommendation.skillSlugs.length > 0) {
    const slugSet = recommendation.skillSlugs.map(s => s.toLowerCase());
    const affectedRows = await db
      .select({ id: skillAnalyzerResults.id, candidateSlug: skillAnalyzerResults.candidateSlug, agentProposals: skillAnalyzerResults.agentProposals })
      .from(skillAnalyzerResults)
      .where(and(
        eq(skillAnalyzerResults.jobId, jobId),
        eq(skillAnalyzerResults.classification, 'DISTINCT'),
      ));
    const proposed = proposedNewAgents[0];
    for (const row of affectedRows) {
      if (!slugSet.includes(row.candidateSlug.toLowerCase())) continue;
      const existing = Array.isArray(row.agentProposals) ? row.agentProposals as Array<Record<string, unknown>> : [];
      // Skip if we've already injected this proposal on a previous run.
      if (existing.some(p => p?.isProposedNewAgent === true && p?.proposedAgentIndex === proposed.proposedAgentIndex)) {
        continue;
      }
      const synthetic = {
        systemAgentId: null,
        slugSnapshot: proposed.slug,
        nameSnapshot: proposed.name,
        score: 1.0,
        selected: true,
        isProposedNewAgent: true,
        proposedAgentIndex: proposed.proposedAgentIndex,
      };
      // Place the proposed agent at the top so the UI ranks it first.
      const nextProposals = [synthetic, ...existing];
      await db
        .update(skillAnalyzerResults)
        .set({ agentProposals: nextProposals })
        .where(eq(skillAnalyzerResults.id, row.id));
    }
  }
}

export const skillAnalyzerService = {
  createJob,
  resumeJob,
  getJob,
  listJobs,
  setResultAction,
  bulkSetResultAction,
  updateAgentProposal,
  updateProposedAgent,
  patchMergeFields,
  resetMergeToOriginal,
  resolveWarning,
  executeApproved,
  unlockStaleExecution,
  updateJobProgress,
  retryClassification,
  bulkRetryFailedClassifications,
  // Internal — used by job handler only
  getJobById,
  insertResults,
  insertSingleResult,
  listResultIndicesForJob,
  markSkillInFlight,
  unmarkSkillInFlight,
  updateResultAgentProposals,
  updateJobAgentRecommendation,
  appendBatchCollisionWarnings,
  applyBatchDeductionAndWarningAtomic,
};
