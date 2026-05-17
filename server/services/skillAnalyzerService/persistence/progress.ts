import { eq, and, isNull } from 'drizzle-orm';
import { logger } from '../../../lib/logger.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import type { AgentRecommendation } from '../../skillAnalyzerServicePure.js';
import type { ClassifyState } from '../../../db/schema/skillAnalyzerJobs.js';
import { slugifyName } from '../helpers/slugify.js';
import { skillAnalyzerJobs, skillAnalyzerResults } from '../../../db/schema/index.js';
import type { SkillAnalyzerJobStatus } from '../../skillAnalyzerServicePure.js';

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

  await getOrgScopedDb('skillAnalyzerService.updateJobProgress')
    .update(skillAnalyzerJobs)
    .set(values)
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
  const updated = await getOrgScopedDb('skillAnalyzerService.updateJobAgentRecommendation')
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
    const affectedRows = await getOrgScopedDb('skillAnalyzerService.updateJobAgentRecommendation.selectResults')
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
      await getOrgScopedDb('skillAnalyzerService.updateJobAgentRecommendation.updateResult')
        .update(skillAnalyzerResults)
        .set({ agentProposals: nextProposals })
        .where(eq(skillAnalyzerResults.id, row.id));
    }
  }
}
