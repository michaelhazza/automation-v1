import { eq, and } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { skillAnalyzerJobs, skillAnalyzerResults } from '../../../db/schema/index.js';
import { systemSkills } from '../../../db/schema/systemSkills.js';
import { skillAnalyzerServicePure } from '../../skillAnalyzerServicePure.js';
import { buildClassifierFailureOutcome, CLASSIFIER_FALLBACK_WARNING } from '../../skillAnalyzerServicePure.js';
import type { LibrarySkillSummary, MergeWarning, ProposedMerge } from '../../skillAnalyzerServicePure.js';
import { routeCall } from '../../llmRouter.js';
import { ParseFailureError } from '../../../lib/parseFailureError.js';
import { truncateUtf8Safe } from '../../../lib/utf8Truncate.js';
import type { ParsedSkill } from '../../skillParserServicePure.js';

// ---------------------------------------------------------------------------
// Classification retry helpers
// ---------------------------------------------------------------------------

/** Classification outcome returned by the LLM classify stage.
 *  `mergeRationale` is populated on the rule-based fallback path (same helper
 *  as skillAnalyzerJob.ts Stage 5) so the retry path can persist it to the
 *  `merge_rationale` column. */
type ClassificationOutcome = {
  classification: 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';
  confidence: number;
  reasoning: string;
  proposedMerge: ProposedMerge | null;
  mergeRationale: string | null;
  classifierFallbackApplied: boolean;
};

/** Run LLM classification for a single candidate/library pair.
 *  Reuses the same model, backoff, and prompt as skillAnalyzerJob.ts Stage 5.
 *  Returns the classification result plus failure metadata. */
async function classifySingleCandidate(
  candidate: ParsedSkill,
  matchedLib: LibrarySkillSummary,
  similarityScore: number,
  jobId: string,
  organisationId: string,
): Promise<{
  result: ClassificationOutcome;
  classificationFailed: boolean;
  classificationFailureReason: 'rate_limit' | 'parse_error' | 'timed_out' | 'unknown' | null;
}> {
  const band = skillAnalyzerServicePure.classifyBand(similarityScore);
  const { system, userMessage } = skillAnalyzerServicePure.buildClassifyPromptWithMerge(
    candidate,
    matchedLib,
    band as 'likely_duplicate' | 'ambiguous',
  );

  let parsed: ReturnType<typeof skillAnalyzerServicePure.parseClassificationResponseWithMerge>;
  let apiError: unknown = undefined;

  try {
    // Route through llmRouter so this service-layer classify call shows up
    // in llm_requests alongside the job-layer sites. The router handles
    // retries on provider errors + parse failures (via postProcess) via
    // its fallback loop; the outer withBackoff from before is retired.
    const response = await routeCall({
      system,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 8192,
      temperature: 0.1,
      context: {
        organisationId,
        sourceType:         'analyzer',
        sourceId:           jobId,
        featureTag:         'skill-analyzer-service-classify',
        taskType:           'general',
        systemCallerPolicy: 'bypass_routing',
        provider:           'anthropic',
        model:              'claude-sonnet-4-6',
      },
      postProcess: (content: string) => {
        const res = skillAnalyzerServicePure.parseClassificationResponseWithMerge(content);
        if (res === null) {
          throw new ParseFailureError({ rawExcerpt: truncateUtf8Safe(content, 2048) });
        }
      },
    });
    parsed = skillAnalyzerServicePure.parseClassificationResponseWithMerge(response.content);
  } catch (err) {
    parsed = null;
    // Parse failures are not "API errors" for the failure-reason derivation;
    // the router has already recorded the ledger row with status='parse_failure'.
    apiError = (err as { code?: string })?.code === 'CLASSIFICATION_PARSE_FAILURE' ? undefined : err;
  }

  const classificationFailed = parsed === null;

  // On failure: route through the same fallback helper the Stage-5 job uses so
  // the reviewer sees a concrete rule-based proposal instead of "Proposal
  // unavailable." Both code paths MUST go through buildClassifierFailureOutcome
  // so the failure behaviour stays in lockstep.
  if (classificationFailed) {
    const fallback = buildClassifierFailureOutcome({
      candidate: {
        name: candidate.name,
        description: candidate.description,
        definition: (candidate.definition as object | null) ?? null,
        instructions: candidate.instructions ?? null,
      },
      library: {
        name: matchedLib.name,
        description: matchedLib.description,
        definition: (matchedLib.definition as object | null) ?? null,
        instructions: matchedLib.instructions ?? null,
      },
    });
    return {
      result: {
        classification: fallback.classification,
        confidence: fallback.confidence,
        reasoning: fallback.reasoning,
        proposedMerge: fallback.proposedMerge,
        mergeRationale: fallback.mergeRationale,
        classifierFallbackApplied: true,
      },
      classificationFailed: true,
      classificationFailureReason:
        skillAnalyzerServicePure.deriveClassificationFailureReason(apiError ?? null),
    };
  }

  // Success path: the LLM gave us a parseable result. It may or may not
  // include a proposedMerge (DUPLICATE / DISTINCT legitimately return null).
  return {
    result: {
      classification: parsed!.classification,
      confidence: parsed!.confidence,
      reasoning: parsed!.reasoning,
      proposedMerge: (parsed!.proposedMerge as ProposedMerge | null) ?? null,
      mergeRationale: (parsed!.proposedMerge as ProposedMerge | null)?.mergeRationale ?? null,
      classifierFallbackApplied: false,
    },
    classificationFailed: false,
    classificationFailureReason: null,
  };
}

/** Retry classification for a single result row that has classificationFailed=true.
 *  Idempotent: returns immediately if the row is not in a failed state.
 *  Uses the stored parsedCandidates + similarityScore — no re-parse or re-embed. */
export async function retryClassification(
  jobId: string,
  resultId: string,
  organisationId: string,
): Promise<void> {
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
  const jobRows = await db
    .select()
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);
  if (!jobRows[0]) throw { statusCode: 404, message: 'Job not found' };
  const job = jobRows[0];

  const resultRows = await getOrgScopedDb('skillAnalyzerService.retryClassification.read')
    .select()
    .from(skillAnalyzerResults)
    .where(and(eq(skillAnalyzerResults.id, resultId), eq(skillAnalyzerResults.jobId, jobId)))
    .limit(1);
  if (!resultRows[0]) throw { statusCode: 404, message: 'Result not found' };
  const result = resultRows[0];

  // Idempotency guard: no-op if the row is not in a failed classification state
  if (!result.classificationFailed) return;

  const candidates = (job.parsedCandidates ?? []) as ParsedSkill[];
  const candidate = candidates[result.candidateIndex];
  if (!candidate) throw { statusCode: 422, message: 'Candidate not found in job parsedCandidates' };
  if (!result.matchedSkillId) throw { statusCode: 422, message: 'No matched skill to classify against' };
  if (result.similarityScore == null) throw { statusCode: 422, message: 'Missing similarity score' };

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
  const matchedSkillRows = await db
    .select()
    .from(systemSkills)
    .where(eq(systemSkills.id, result.matchedSkillId))
    .limit(1);
  if (!matchedSkillRows[0]) throw { statusCode: 422, message: 'Matched skill no longer exists' };
  const matchedSkill = matchedSkillRows[0];

  const matchedLib: LibrarySkillSummary = {
    id: matchedSkill.id,
    slug: matchedSkill.slug,
    name: matchedSkill.name,
    description: matchedSkill.description ?? '',
    definition: matchedSkill.definition as object,
    instructions: matchedSkill.instructions ?? null,
    isSystem: true,
  };

  const { result: classificationRaw, classificationFailed, classificationFailureReason } =
    await classifySingleCandidate(candidate, matchedLib, result.similarityScore, jobId, organisationId);

  // v6 Fix 5 (mirror): post-classifier DISTINCT_FALLBACK. Mirrors
  // skillAnalyzerJob.ts:1060-1091 so retries stay in lockstep with the main
  // classify path. When the LLM returned PARTIAL_OVERLAP/IMPROVEMENT but the
  // candidate cross-references the matched library skill AND similarity is
  // below 70%, reclassify as DISTINCT — merging would produce a confused
  // hybrid. Higher-similarity cross-references remain as merges; the main
  // path flags them via validation and that flagging is not mirrored on
  // retry (see note above about validate/remediate scope).
  let classification = classificationRaw;
  if (
    (classification.classification === 'PARTIAL_OVERLAP' ||
      classification.classification === 'IMPROVEMENT') &&
    skillAnalyzerServicePure.crossReferencesLibrarySkill(
      candidate.description,
      matchedLib.name,
      matchedLib.slug,
    ) &&
    result.similarityScore < 0.70
  ) {
    classification = {
      classification: 'DISTINCT',
      confidence: 0.5,
      reasoning:
        `${classification.reasoning} — post-classifier DISTINCT_FALLBACK: incoming skill cross-references "${matchedLib.name}" as a separate tool (similarity ${Math.round(result.similarityScore * 100)}%), so the merge was discarded in favour of presenting this as a new skill.`,
      proposedMerge: null,
      mergeRationale: null,
      classifierFallbackApplied: false,
    };
  }

  const diffSummary = skillAnalyzerServicePure.generateDiffSummary(candidate, matchedLib);

  // Strip mergeRationale before persisting to proposed_merged_content — the
  // rationale lives in its own DB column (same contract as the Stage-5 job).
  const storedMerge: ProposedMerge | null = classification.proposedMerge
    ? { ...classification.proposedMerge, mergeRationale: undefined }
    : null;

  // When the fallback path ran, surface CLASSIFIER_FALLBACK so the UI banner
  // + approval gate activate (mirrors skillAnalyzerJob.ts:1092-1101). Full
  // validateMergeOutput / remediateTables re-validation on retry is tracked
  // separately — retry currently persists just the fallback marker.
  const mergeWarnings: MergeWarning[] | null = classification.classifierFallbackApplied
    ? [CLASSIFIER_FALLBACK_WARNING]
    : null;

  await getOrgScopedDb('skillAnalyzerService.retryClassification.update')
    .update(skillAnalyzerResults)
    .set({
      classification: classification.classification,
      confidence: classification.confidence,
      classificationReasoning: classification.reasoning,
      diffSummary,
      proposedMergedContent: storedMerge,
      mergeRationale: classification.mergeRationale,
      mergeWarnings,
      classifierFallbackApplied: classification.classifierFallbackApplied,
      // Only seed the immutable original if it has never been set — retries
      // must not overwrite it, otherwise "Reset to AI suggestion" would
      // restore the retry's output rather than the original job output.
      ...(result.originalProposedMerge === null && storedMerge !== null
        ? { originalProposedMerge: storedMerge }
        : {}),
      classificationFailed,
      classificationFailureReason,
    })
    .where(
      and(
        eq(skillAnalyzerResults.id, resultId),
        eq(skillAnalyzerResults.classificationFailed, true), // optimistic concurrency
      ),
    );
}

/** Retry all classificationFailed=true results in a job sequentially
 *  (no parallel burst) with jittered delay to avoid re-triggering 429s. */
export async function bulkRetryFailedClassifications(
  jobId: string,
  organisationId: string,
): Promise<{ retried: number; stillFailed: number }> {
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
  const jobRows = await db
    .select({ id: skillAnalyzerJobs.id })
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);
  if (!jobRows[0]) throw { statusCode: 404, message: 'Job not found' };

  const failedResults = await getOrgScopedDb('skillAnalyzerService.bulkRetryFailedClassifications.readFailed')
    .select({ id: skillAnalyzerResults.id })
    .from(skillAnalyzerResults)
    .where(
      and(
        eq(skillAnalyzerResults.jobId, jobId),
        eq(skillAnalyzerResults.classificationFailed, true),
      ),
    );

  for (let i = 0; i < failedResults.length; i++) {
    try {
      await retryClassification(jobId, failedResults[i].id, organisationId);
    } catch {
      // Row has a data-integrity problem (missing candidate / matchedSkillId /
      // similarityScore) — cannot be retried. Leave classificationFailed=true
      // and continue with remaining rows so one bad row doesn't abort the batch.
    }
    // Jittered delay: 500–1500ms between calls to avoid re-triggering 429s
    if (i < failedResults.length - 1) {
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));
    }
  }

  const remaining = await getOrgScopedDb('skillAnalyzerService.bulkRetryFailedClassifications.readRemaining')
    .select({ id: skillAnalyzerResults.id })
    .from(skillAnalyzerResults)
    .where(
      and(
        eq(skillAnalyzerResults.jobId, jobId),
        eq(skillAnalyzerResults.classificationFailed, true),
      ),
    );

  // retried = number of rows attempted (all failed rows are always attempted once)
  return { retried: failedResults.length, stillFailed: remaining.length };
}
