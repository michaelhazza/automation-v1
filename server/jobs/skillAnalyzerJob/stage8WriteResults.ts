import {
  updateJobProgress,
  insertResults,
  updateResultAgentProposals,
} from '../../services/skillAnalyzerService.js';
import type { skillAnalyzerResults } from '../../db/schema/index.js';
import {
  type ConsolidationOutcome,
} from '../../services/skillAnalyzerServicePure.js';
import { type JobContext } from './types.js';

// -------------------------------------------------------------------------
// Stage 8: Write Results (90% → 100%)
// -------------------------------------------------------------------------
export async function runStage8(ctx: JobContext, jobId: string): Promise<JobContext> {
  const {
    candidates,
    distinctResults,
    exactDuplicates,
    nonSkillFlagsByIndex,
    classifiedResults,
    completedCandidateIndices,
    agentProposalsByCandidateIndex,
  } = ctx;
  const getCandidateHash = ctx.hashFromCandidateContent;

  await updateJobProgress(jobId, {
    progressPct: 90,
    progressMessage: 'Writing results...',
  });

  // Collect all result rows
  const resultRows: (typeof skillAnalyzerResults.$inferInsert)[] = [];

  // Exact duplicates from Stage 2
  for (const dup of exactDuplicates) {
    const candidate = candidates[dup.candidateIndex];
    resultRows.push({
      jobId,
      candidateIndex: dup.candidateIndex,
      candidateName: candidate.name,
      candidateSlug: candidate.slug,
      candidateContentHash: getCandidateHash(dup.candidateIndex),
      matchedSkillId: dup.matchedLib.id ?? undefined,
      classification: 'DUPLICATE',
      confidence: 1.0,
      similarityScore: 1.0,
      classificationReasoning: 'Exact content match (identical content hash).',
      diffSummary: null,
      // Spec §10 state-machine closure: post-migration rows MUST carry one of
      // the four enum values, never NULL. DUPLICATE rows produce no merge, so
      // consolidation never fires for them — write 'not_triggered'.
      consolidationOutcome: 'not_triggered' as ConsolidationOutcome,
    });
  }

  // Distinct from Stage 4
  for (const m of distinctResults) {
    const candidate = candidates[m.candidateIndex];
    const flags = nonSkillFlagsByIndex.get(m.candidateIndex);
    resultRows.push({
      jobId,
      candidateIndex: m.candidateIndex,
      candidateName: candidate.name,
      candidateSlug: candidate.slug,
      candidateContentHash: getCandidateHash(m.candidateIndex),
      matchedSkillId: undefined,
      classification: 'DISTINCT',
      confidence: 1 - m.similarity,
      similarityScore: m.similarity,
      classificationReasoning: `Low embedding similarity (${(m.similarity * 100).toFixed(0)}%) - no existing skill is close.`,
      diffSummary: null,
      // Phase 2: agent proposals from the Agent-propose stage above. The
      // map only has entries for DISTINCT candidates that had a candidate
      // embedding; rows with no proposals fall back to the column default
      // of [].
      agentProposals: agentProposalsByCandidateIndex.get(m.candidateIndex) ?? [],
      isDocumentationFile: flags?.isDocumentationFile ?? false,
      isContextFile: flags?.isContextFile ?? false,
      // Spec §10 state-machine closure: post-migration rows MUST carry one of
      // the four enum values. DISTINCT rows produce no merge — write
      // 'not_triggered'.
      consolidationOutcome: 'not_triggered' as ConsolidationOutcome,
    });
  }

  // On crash-resume, Stage 2 exactDuplicate rows and Stage 4 distinctResults
  // rows that were already written by a prior run must not be re-inserted —
  // skill_analyzer_results has no UNIQUE(job_id, candidate_index) constraint,
  // so a plain insert would silently duplicate every such row. Filter against
  // the indices we observed at the start of Stage 5. candidateIndex is
  // `integer().notNull()` with no default, so $inferInsert types it as number;
  // no nullability guard needed.
  const resultRowsToWrite = resultRows.filter(
    (row) => !completedCandidateIndices.has(row.candidateIndex),
  );

  // Insert via service (avoids direct db import in jobs)
  await insertResults(resultRowsToWrite);

  // Backfill agentProposals onto classified-DISTINCT rows. These rows were
  // written incrementally in Stage 5 (before Stage 7 ran), so their
  // agentProposals column is still the default []. Patch them now.
  const classifiedDistinct = classifiedResults.filter(
    (r) => r.classification === 'DISTINCT',
  );
  for (const r of classifiedDistinct) {
    const proposals = agentProposalsByCandidateIndex.get(r.candidateIndex) ?? [];
    await updateResultAgentProposals(jobId, r.candidateIndex, proposals);
  }

  return { ...ctx, classifiedDistinct };
}
