import { env } from '../../lib/env.js';
import {
  updateJobProgress,
  insertSingleResult,
  listResultIndicesForJob,
  markSkillInFlight,
  unmarkSkillInFlight,
} from '../../services/skillAnalyzerService.js';
import { SKILL_CLASSIFY_TIMEOUT_MS } from '../../config/limits.js';
import {
  skillAnalyzerServicePure,
  validateMergeOutput,
  extractInvocationBlock,
  richnessScore,
  buildRuleBasedMerge,
  buildClassifierFailureOutcome,
  remediateTables,
  decontaminateSectionRows,
  stripSourceAnnotations,
  recoverDroppedTableRows,
  recoverOutputFormat,
  startsWithPersonaOpener,
  detectSkillGraphCollision,
  buildConsolidationPrompt,
  parseConsolidationResponse,
  computeConsolidationViolations,
  type LibrarySkillSummary,
  type MergeWarning,
  type ProposedMerge,
  type ConsolidationOutcome,
} from '../../services/skillAnalyzerServicePure.js';
import { routeCall } from '../../services/llmRouter.js';
import { ParseFailureError } from '../../lib/parseFailureError.js';
import { truncateUtf8Safe } from '../../lib/utf8Truncate.js';
import { logger } from '../../lib/logger.js';
import { getPLimit, consolidationWordCount } from './helpers.js';
import { classifyConsolidationOutcome } from './consolidationOutcomePure.js';
import { type ClassifiedResult, type JobContext } from './types.js';

// -------------------------------------------------------------------------
// Stage 5: Classify (60% → 90%)
// -------------------------------------------------------------------------
// When ANTHROPIC_API_KEY is not configured, the LLM classification step
// cannot run. Rather than burning 3 backoff retries per candidate on a
// call that will always throw PROVIDER_NOT_CONFIGURED (which leaves the
// UI hanging on "Classifying with AI..." for minutes), detect the missing
// key upfront and route every queued candidate directly to PARTIAL_OVERLAP
// for human review. Mirrors the existing OPENAI_API_KEY fallback in the
// embedding stage above.
export async function runStage5(ctx: JobContext, jobId: string): Promise<JobContext> {
  const {
    candidates,
    librarySkills,
    llmQueue,
    nonSkillFlagsByIndex,
    job,
    configSnapshot,
    validationThresholds,
  } = ctx;
  const getCandidateHash = ctx.hashFromCandidateContent;

  const classificationFallback = !env.ANTHROPIC_API_KEY;

  // Crash-resume: read any result rows already written by a prior worker run.
  // Each existing row represents a classification that has already been paid
  // for at the provider and persisted locally — we must not re-call for it.
  const existingResultRows = await listResultIndicesForJob(jobId);
  const completedCandidateIndices = new Set<number>(
    existingResultRows.map((r) => r.candidateIndex),
  );
  const resumedLlmQueue = llmQueue.filter(
    (m) => !completedCandidateIndices.has(m.candidateIndex),
  );
  const resumedSkippedCount = llmQueue.length - resumedLlmQueue.length;
  if (resumedSkippedCount > 0) {
    logger.info('skill_analyzer.stage5_resume', {
      jobId,
      alreadyClassified: resumedSkippedCount,
      remainingToClassify: resumedLlmQueue.length,
      totalLlmQueue: llmQueue.length,
    });
  }

  await updateJobProgress(jobId, {
    status: 'classifying',
    progressPct: 60,
    progressMessage: classificationFallback
      ? 'LLM classification unavailable - marking candidates for human review...'
      : 'Classifying with AI...',
    classifyState: {
      // Full LLM-candidate list (not just remaining) so the UI can show all
      // skills in stable original order. Already-classified ones render as
      // 'done' via deriveRowStatus; the inFlight map is reset — any entries
      // from a prior crashed process refer to calls that are definitively dead.
      queue: llmQueue.map((m) => candidates[m.candidateIndex].slug),
      inFlight: {},
    },
  });

  const classifiedResults: ClassifiedResult[] = [];

  // On resume, seed classifiedResults with minimal entries for rows that
  // were written by an earlier run — Stages 7, 7b, and 8 read classifiedResults
  // to pick DISTINCT candidates for agent-propose / Haiku enrichment and to
  // backfill agentProposals onto existing rows. Entries here only carry the
  // fields those stages actually use (candidateIndex + classification); other
  // fields are filled with neutral defaults.
  //
  // IMPORTANT — RESUME RECONSTRUCTION CONTRACT:
  //   The neutral defaults below (confidence=0, similarityScore=null,
  //   libraryId=null, proposedMerge=null, …) are safe ONLY because the
  //   downstream consumers of classifiedResults read exclusively:
  //     • r.candidateIndex (Stage 7 agent-propose lookup, Stage 7b enrich set,
  //       Stage 8 updateResultAgentProposals target)
  //     • r.classification (Stage 7 DISTINCT filter, Stage 8 classifiedDistinct
  //       filter)
  //   If a future change introduces a consumer that reads ANY other field
  //   from classifiedResults (e.g. r.confidence, r.proposedMerge,
  //   r.similarityScore, r.libraryId), the resumed entries will deliver the
  //   neutral default — NOT the real value from the prior run — and crash-
  //   resume behaviour will silently diverge from a fresh run. When adding
  //   such a consumer, either:
  //     (a) extend listResultIndicesForJob + this seeding block to hydrate
  //         the new field from the DB row, or
  //     (b) have the consumer re-query skill_analyzer_results directly
  //         instead of reading through classifiedResults.
  //   Test: server/services/__tests__/skillAnalyzerJobResumePure.test.ts
  //   should assert that every field consumed by Stages 6+ is either
  //   hydrated or explicitly defaulted.
  if (completedCandidateIndices.size > 0) {
    const llmQueueIndices = new Set(llmQueue.map((m) => m.candidateIndex));
    for (const existing of existingResultRows) {
      // Only replay rows that represent a Stage-5 LLM classification — i.e.
      // rows whose candidateIndex was in the llmQueue this run. Rows for
      // exactDuplicates (Stage 2) and Stage-4 distinctResults are written in
      // Stage 8; they'll be re-added to resultRows below and deduped there.
      if (!llmQueueIndices.has(existing.candidateIndex)) continue;
      const candidate = candidates[existing.candidateIndex];
      if (!candidate) continue;
      classifiedResults.push({
        candidateIndex:                existing.candidateIndex,
        candidate,
        classification:                existing.classification,
        confidence:                    0,
        similarityScore:               null,
        classificationReasoning:       null,
        // v5 infra: hydrate libraryId + proposedMerge from DB so Stage 5c
        // fork/overlap detection works correctly on resumed runs.
        libraryId:                     existing.matchedSkillId ?? null,
        librarySlug:                   null,
        libraryName:                   null,
        diffSummary:                   null,
        proposedMerge:                 existing.proposedMergedInstructions != null
          ? {
              name:        existing.proposedMergedName ?? '',
              description: '',
              definition:  {},
              instructions: existing.proposedMergedInstructions,
            }
          : null,
        classificationFailed:          false,
        classificationFailureReason:   null,
      });
    }
  }

  // Build a lookup for library skills by slug
  const libraryBySlug = new Map<string, LibrarySkillSummary>(
    librarySkills.map((lib) => [lib.slug, lib])
  );

  if (classificationFallback) {
    console.warn(
      '[SkillAnalyzerJob] ANTHROPIC_API_KEY not set - skipping LLM classification; all ambiguous pairs routed to PARTIAL_OVERLAP for human review'
    );

    for (const match of resumedLlmQueue) {
      const candidate = candidates[match.candidateIndex];
      const matchedLib = match.librarySlug ? libraryBySlug.get(match.librarySlug) : null;

      if (!candidate) {
        // Should be unreachable — every index in llmQueue comes from bestMatches
        // which is bounded by candidates.length. Log and skip to avoid a ghost
        // entry in classifiedResults with an undefined candidate.
        console.warn('[SkillAnalyzerJob] candidate undefined for candidateIndex', match.candidateIndex);
        continue;
      }

      if (!matchedLib) {
        classifiedResults.push({
          candidateIndex: match.candidateIndex,
          candidate,
          classification: 'DISTINCT',
          confidence: 0.5,
          similarityScore: match.similarity,
          classificationReasoning: 'Library skill not found - treating as distinct.',
          libraryId: null,
          librarySlug: null,
          libraryName: null,
          diffSummary: null,
          proposedMerge: null,
          classificationFailed: false,
          classificationFailureReason: null,
        });
        {
          const flags = nonSkillFlagsByIndex.get(match.candidateIndex);
          await insertSingleResult({
            jobId,
            candidateIndex: match.candidateIndex,
            candidateName: candidate.name,
            candidateSlug: candidate.slug,
            candidateContentHash: getCandidateHash(match.candidateIndex),
            matchedSkillId: undefined,
            classification: 'DISTINCT',
            confidence: 0.5,
            similarityScore: match.similarity ?? undefined,
            classificationReasoning: 'Library skill not found - treating as distinct.',
            classificationFailed: false,
            classificationFailureReason: null,
            isDocumentationFile: flags?.isDocumentationFile ?? false,
            isContextFile: flags?.isContextFile ?? false,
            preConsolidationMerge: null,
            consolidationOutcome: 'not_triggered' as ConsolidationOutcome,
            consolidationNote: null,
          });
        }
        continue;
      }

      const diffSummary = skillAnalyzerServicePure.generateDiffSummary(candidate, matchedLib);

      // v2 Fix 1: rule-based fallback merge so the reviewer sees a concrete
      // proposal instead of a dead state. Always emits CLASSIFIER_FALLBACK
      // plus whatever validateMergeOutput surfaces.
      const fallbackOutput = buildRuleBasedMerge({
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

      // Validate the rule-based merge so NAME_MISMATCH / SCOPE_EXPANSION /
      // TABLE_ROWS_DROPPED etc. still surface.
      const baseSkill = richnessScore(candidate.instructions) >= richnessScore(matchedLib.instructions) ? candidate : matchedLib;
      const nonBaseSkill = baseSkill === candidate ? matchedLib : candidate;
      const baseInvocation = extractInvocationBlock(baseSkill.instructions);
      const nonBaseInvocation = extractInvocationBlock(nonBaseSkill.instructions);
      const excludedId = matchedLib.id ?? null;
      const allLibraryNames = new Set(
        librarySkills.filter(s => s.id !== excludedId).map(s => s.name.toLowerCase()),
      );
      const allLibrarySlugs = new Set(
        librarySkills.filter(s => s.id !== excludedId).map(s => s.slug.toLowerCase()),
      );

      const fallbackWarnings: MergeWarning[] = [
        {
          code: 'CLASSIFIER_FALLBACK',
          severity: 'warning',
          message: 'Rule-based fallback merge applied — classifier unavailable. Review carefully.',
        },
        ...validateMergeOutput(
          { definition: baseSkill.definition as object | null, instructions: baseSkill.instructions, invocationBlock: baseInvocation },
          { definition: nonBaseSkill.definition as object | null, instructions: nonBaseSkill.instructions, invocationBlock: nonBaseInvocation },
          fallbackOutput.merge,
          allLibraryNames,
          allLibrarySlugs,
          librarySkills,
          excludedId,
          validationThresholds,
          candidate.name,
        ),
      ];

      classifiedResults.push({
        candidateIndex: match.candidateIndex,
        candidate,
        classification: 'PARTIAL_OVERLAP',
        confidence: 0.3,
        similarityScore: match.similarity,
        classificationReasoning:
          'LLM classification unavailable (ANTHROPIC_API_KEY not configured) - rule-based fallback merge applied for human review.',
        libraryId: matchedLib.id,
        librarySlug: matchedLib.slug,
        libraryName: matchedLib.name,
        diffSummary,
        proposedMerge: fallbackOutput.merge,
        classificationFailed: false,
        classificationFailureReason: null,
      });
      {
        const flags = nonSkillFlagsByIndex.get(match.candidateIndex);
        await insertSingleResult({
          jobId,
          candidateIndex: match.candidateIndex,
          candidateName: candidate.name,
          candidateSlug: candidate.slug,
          candidateContentHash: getCandidateHash(match.candidateIndex),
          matchedSkillId: matchedLib.id ?? undefined,
          classification: 'PARTIAL_OVERLAP',
          confidence: 0.3,
          similarityScore: match.similarity ?? undefined,
          classificationReasoning:
            'LLM classification unavailable (ANTHROPIC_API_KEY not configured) - rule-based fallback merge applied for human review.',
          diffSummary: diffSummary ?? undefined,
          proposedMergedContent: fallbackOutput.merge,
          originalProposedMerge: fallbackOutput.merge,
          mergeWarnings: fallbackWarnings,
          mergeRationale: fallbackOutput.mergeRationale,
          classifierFallbackApplied: true,
          classificationFailed: false,
          classificationFailureReason: null,
          isDocumentationFile: flags?.isDocumentationFile ?? false,
          isContextFile: flags?.isContextFile ?? false,
          preConsolidationMerge: null,
          consolidationOutcome: 'not_triggered' as ConsolidationOutcome,
          consolidationNote: null,
        });
      }
    }

    await updateJobProgress(jobId, {
      progressPct: 89,
      progressMessage: `Routed ${llmQueue.length} candidate${llmQueue.length === 1 ? '' : 's'} to human review (LLM unavailable)`,
    });
  } else {
    // Concurrency 3: all classify calls run in parallel. Drop to 2 if
    // 429 rate-limit stalls occur on large marketing-heavy imports.
    const limit = await getPLimit(3);
    // Resume-aware progress: start the counter at the number of candidates
    // that were already classified by a prior run so the UI percentage doesn't
    // regress after a worker restart.
    let classifiedCount = resumedSkippedCount;

    await Promise.all(
      resumedLlmQueue.map((match) =>
        limit(async () => {
          const candidate = candidates[match.candidateIndex];
          const matchedLib = match.librarySlug ? libraryBySlug.get(match.librarySlug) : null;

          if (!candidate) {
            // Should be unreachable — indices come from bestMatches which is
            // bounded by candidates.length. Skip to avoid a ghost entry.
            console.warn('[SkillAnalyzerJob] candidate undefined for candidateIndex', match.candidateIndex);
            return;
          }

          if (!matchedLib) {
            classifiedResults.push({
              candidateIndex: match.candidateIndex,
              candidate,
              classification: 'DISTINCT',
              confidence: 0.5,
              similarityScore: match.similarity,
              classificationReasoning: 'Library skill not found - treating as distinct.',
              libraryId: null,
              librarySlug: null,
              libraryName: null,
              diffSummary: null,
              proposedMerge: null,
              classificationFailed: false,
              classificationFailureReason: null,
            });
            // Write immediately — Stage 8 no longer writes classifiedResults rows.
            {
              const flags = nonSkillFlagsByIndex.get(match.candidateIndex);
              await insertSingleResult({
                jobId,
                candidateIndex: match.candidateIndex,
                candidateName: candidate.name,
                candidateSlug: candidate.slug,
                candidateContentHash: getCandidateHash(match.candidateIndex),
                matchedSkillId: undefined,
                classification: 'DISTINCT',
                confidence: 0.5,
                similarityScore: match.similarity ?? undefined,
                classificationReasoning: 'Library skill not found - treating as distinct.',
                classificationFailed: false,
                classificationFailureReason: null,
                isDocumentationFile: flags?.isDocumentationFile ?? false,
                isContextFile: flags?.isContextFile ?? false,
                preConsolidationMerge: null,
                consolidationOutcome: 'not_triggered' as ConsolidationOutcome,
                consolidationNote: null,
              });
            }
            return;
          }

          const startMs = Date.now();
          console.log('[SkillAnalyzer] classify:start', {
            jobId,
            slug: candidate.slug,
            candidateIndex: match.candidateIndex,
          });
          await markSkillInFlight(jobId, candidate.slug, startMs);

          // Phase 3: use the merge-aware prompt + parser. The system prompt
          // is a superset of the base classifier — it adds instructions for
          // producing a proposedMerge object on PARTIAL_OVERLAP / IMPROVEMENT.
          const { system, userMessage } = skillAnalyzerServicePure.buildClassifyPromptWithMerge(
            candidate,
            matchedLib,
            match.band as 'likely_duplicate' | 'ambiguous',
          );

          let classificationResult: ReturnType<typeof skillAnalyzerServicePure.parseClassificationResponseWithMerge>;
          let classificationApiError: unknown = undefined;

          // One-shot retry on outer timeout. The timeout fires an
          // AbortController that actually terminates the underlying fetch —
          // unlike the previous Promise.race pattern which abandoned the
          // fetch and eventually surfaced as an unexplained 499 on the
          // provider side. A stuck generation often finishes fast on a
          // second attempt; doubling the worst-case wall clock is worth
          // trading for an LLM merge over a rule-based one.
          const MAX_CLASSIFY_TIMEOUT_RETRIES = 1;
          let timeoutRetries = 0;

          while (true) {
            const abortController = new AbortController();
            // Pass 'caller_timeout' as the reason so the adapter can
            // distinguish analyzer-side timeout from user-initiated cancel
            // (see spec §8.1).
            // reason: timeoutId is consumed by clearTimeout in the finally block; ESLint cannot see cross-block usage.
            // eslint-disable-next-line no-useless-assignment
            const timeoutId = setTimeout(
              () => abortController.abort('caller_timeout'),
              SKILL_CLASSIFY_TIMEOUT_MS,
            );

            try {
              const response = await routeCall({
                system,
                messages: [{ role: 'user', content: userMessage }],
                // 8192 is the Sonnet 4.6 output ceiling — ensures proposedMerge
                // with long instructions can never be truncated.
                maxTokens: 8192,
                temperature: 0.1,
                context: {
                  organisationId:     job.organisationId,
                  sourceType:         'analyzer',
                  sourceId:           jobId,
                  featureTag:         'skill-analyzer-classify',
                  taskType:           'general',
                  systemCallerPolicy: 'bypass_routing',
                  provider:           'anthropic',
                  model:              'claude-sonnet-4-6',
                },
                abortSignal: abortController.signal,
                postProcess: (content: string) => {
                  const parsed = skillAnalyzerServicePure.parseClassificationResponseWithMerge(content);
                  if (parsed === null) {
                    logger.warn('skill_classify_parse_failure', {
                      jobId,
                      slug: candidate.slug,
                      rawLength: content.length,
                      // Full raw response so we can see exactly what the LLM produced
                      raw: content,
                    });
                    throw new ParseFailureError({ rawExcerpt: truncateUtf8Safe(content, 2048) });
                  }
                },
              });
              // Parse once more to get the typed result. `postProcess` already
              // validated; this call is cheap (plain JSON.parse + schema map).
              classificationResult = skillAnalyzerServicePure.parseClassificationResponseWithMerge(response.content);
              break;
            } catch (err) {
              const code = (err as { code?: string })?.code;
              const abortReason = (err as { abortReason?: string })?.abortReason;
              const wasTimeout = code === 'CLIENT_DISCONNECTED' && abortReason === 'caller_timeout';
              if (wasTimeout && timeoutRetries < MAX_CLASSIFY_TIMEOUT_RETRIES) {
                timeoutRetries++;
                logger.warn('skill_classify_timeout_retry', {
                  jobId,
                  slug: candidate.slug,
                  attempt: timeoutRetries + 1,
                  timeoutMs: SKILL_CLASSIFY_TIMEOUT_MS,
                });
                continue;
              }
              classificationResult = null;
              // Parse failures are not "API errors" from the analyzer's
              // perspective — the rule-based fallback should fire, not the
              // API-error branch. The router has already recorded the row
              // with status='parse_failure' + rawExcerpt.
              classificationApiError = code === 'CLASSIFICATION_PARSE_FAILURE' ? undefined : err;
              break;
            } finally {
              clearTimeout(timeoutId);
            }
          }

          // null result = either API error (classificationApiError set) or parse failure
          const classificationFailed = classificationResult === null;
          const classificationFailureReason = classificationFailed
            ? skillAnalyzerServicePure.deriveClassificationFailureReason(
                classificationApiError ?? null,
              )
            : null;

          if (classificationFailed) {
            logger.warn('skill_classify_failed', {
              jobId,
              slug: candidate.slug,
              reason: classificationFailureReason,
              apiError: classificationApiError
                ? String((classificationApiError as { message?: string }).message ?? classificationApiError)
                : null,
            });
          }

          // v2 Fix 1: when the LLM call failed or parsed to null, apply the
          // rule-based fallback so the reviewer gets a concrete proposal
          // instead of a dead state.
          let classifierFallbackApplied = false;
          let finalResult: {
            classification: 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';
            confidence: number;
            reasoning: string;
            proposedMerge: ({ mergeRationale?: string | null } & Record<string, unknown>) | null;
          };
          if (classificationResult) {
            finalResult = classificationResult as typeof finalResult;
            // Even a "successful" LLM response can have proposedMerge=null
            // (DUPLICATE / DISTINCT legitimately). Only synth a fallback if
            // the classifier returned PARTIAL_OVERLAP / IMPROVEMENT WITH a
            // null merge — that indicates a parse edge case.
            if (
              finalResult.proposedMerge === null &&
              (finalResult.classification === 'PARTIAL_OVERLAP' || finalResult.classification === 'IMPROVEMENT')
            ) {
              const fallback = buildRuleBasedMerge({
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
              finalResult = {
                ...finalResult,
                confidence: Math.min(finalResult.confidence, 0.3),
                reasoning: finalResult.reasoning + ' — LLM merge missing; rule-based fallback applied.',
                proposedMerge: { ...fallback.merge, mergeRationale: fallback.mergeRationale },
              };
              classifierFallbackApplied = true;
            }
          } else {
            // v5 Fix 6: if similarity < 70% AND incoming cross-references the
            // library skill explicitly, the LLM would likely have said DISTINCT.
            // Avoid a low-quality merge by classifying as DISTINCT instead.
            const isDistinctFallback =
              (match.similarity ?? 1) < 0.70 &&
              skillAnalyzerServicePure.crossReferencesLibrarySkill(
                candidate.description,
                matchedLib.name,
                matchedLib.slug,
              );

            if (isDistinctFallback) {
              finalResult = {
                classification: 'DISTINCT',
                confidence: 0.5,
                reasoning: `Classifier unavailable. Matched at ${Math.round((match.similarity ?? 0) * 100)}% with "${matchedLib.name}" but incoming skill cross-references it as a separate tool — treated as distinct. Review manually.`,
                proposedMerge: null,
              };
            } else {
              // LLM call failed or parse error — route through the shared
              // buildClassifierFailureOutcome helper so the job path and the
              // retry path (skillAnalyzerService.ts → classifySingleCandidate)
              // emit identical fallback state.
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
              finalResult = {
                classification: fallback.classification,
                confidence: fallback.confidence,
                reasoning: fallback.reasoning,
                proposedMerge: { ...fallback.proposedMerge, mergeRationale: fallback.mergeRationale },
              };
              classifierFallbackApplied = true;
            }
          }

          // v7-B Fix #3a: self-contradiction check. If the LLM's own merge
          // rationale contains phrases like "neither fully replaces the other"
          // or "produce different artifacts", the model is arguing against its
          // own classification. Flip to DISTINCT before persistence so the
          // reviewer never sees a low-confidence merge with a rationale that
          // disqualifies it. Runs BEFORE the cross-reference check so the
          // classifier's most explicit self-contradiction wins; the cross-ref
          // path picks up cases where the rationale doesn't say it but the
          // candidate description does.
          if (
            (finalResult.classification === 'PARTIAL_OVERLAP' || finalResult.classification === 'IMPROVEMENT') &&
            skillAnalyzerServicePure.rationaleArguesAgainstMerge(finalResult.reasoning)
          ) {
            finalResult = {
              classification: 'DISTINCT',
              confidence: Math.max(finalResult.confidence, 0.80),
              reasoning: `v7-B self-contradiction check: classifier returned ${finalResult.classification} but its own rationale argues against the merge — auto-flipped to DISTINCT. Original reasoning: ${finalResult.reasoning}`,
              proposedMerge: null,
            };
            classifierFallbackApplied = false;
          }

          // v6 Fix 5: post-classifier DISTINCT_FALLBACK. If the LLM returned
          // PARTIAL_OVERLAP but the incoming skill explicitly cross-references
          // the matched library skill as a separate tool ("see X", "for X, use Y"),
          // the incoming is positioning itself as distinct — merging would produce
          // a confused hybrid. Reclassify if similarity is also below 70%; for
          // high-similarity cross-references we keep the merge but add an
          // informational warning so the reviewer is aware.
          let crossRefKeptAsPartialOverlap = false;
          if (
            (finalResult.classification === 'PARTIAL_OVERLAP' || finalResult.classification === 'IMPROVEMENT') &&
            skillAnalyzerServicePure.crossReferencesLibrarySkill(
              candidate.description,
              matchedLib.name,
              matchedLib.slug,
            )
          ) {
            const similarity = match.similarity ?? 1;
            if (similarity < 0.70) {
              finalResult = {
                classification: 'DISTINCT',
                confidence: 0.5,
                reasoning:
                  `${finalResult.reasoning} — post-classifier DISTINCT_FALLBACK: incoming skill cross-references "${matchedLib.name}" as a separate tool (similarity ${Math.round(similarity * 100)}%), so the merge was discarded in favour of presenting this as a new skill.`,
                proposedMerge: null,
              };
              classifierFallbackApplied = false;
            } else {
              // Similarity ≥ 70% → keep PARTIAL_OVERLAP but flag for the
              // informational warning emitted after validation.
              crossRefKeptAsPartialOverlap = true;
            }
          }

          const diffSummary = skillAnalyzerServicePure.generateDiffSummary(candidate, matchedLib);

          // --- Merge validation (Bugs 1–4, 7–10) ---
          // Extract rationale before stripping it from the stored merge.
          let mergeWarnings: MergeWarning[] = [];
          let mergeRationale: string | null = null;
          // Consolidation gate outcome fields — declared at outer scope so
          // insertSingleResult (below the if-block) can always read them.
          let slotConsolidationOutcome: ConsolidationOutcome = 'not_triggered';
          let slotConsolidationNote: string | null = null;
          let slotPreConsolidationMerge: ProposedMerge | null = null;
          type StoredMerge = { name: string; description: string; definition: object; instructions: string | null; mergeRationale?: undefined };
          let storedMerge: StoredMerge | null = finalResult.proposedMerge
            ? {
                ...(finalResult.proposedMerge as unknown as StoredMerge),
                mergeRationale: undefined,
              }
            : null;

          if (
            finalResult.proposedMerge &&
            (finalResult.classification === 'PARTIAL_OVERLAP' || finalResult.classification === 'IMPROVEMENT')
          ) {
            // Extract mergeRationale from parsed proposedMerge before stripping.
            mergeRationale = finalResult.proposedMerge.mergeRationale ?? null;

            // Determine base vs non-base using richnessScore — must match the
            // prompt's Step 1 heuristic. Never use wordCount here.
            const candidateScore = richnessScore(candidate.instructions);
            const libraryScore = richnessScore(matchedLib.instructions);
            const baseSkill = candidateScore >= libraryScore ? candidate : matchedLib;
            const nonBaseSkill = candidateScore >= libraryScore ? matchedLib : candidate;

            // Extract invocation blocks from both sources before validation.
            const baseInvocation = extractInvocationBlock(baseSkill.instructions);
            const nonBaseInvocation = extractInvocationBlock(nonBaseSkill.instructions);

            // Build library exclusion sets (exclude the matched skill itself).
            const excludedId = matchedLib.id ?? null;
            const allLibraryNames = new Set(
              librarySkills.filter(s => s.id !== excludedId).map(s => s.name.toLowerCase())
            );
            const allLibrarySlugs = new Set(
              librarySkills.filter(s => s.id !== excludedId).map(s => s.slug.toLowerCase())
            );

            // v2 Fix 4: auto-recover dropped table rows before validation so
            // TABLE_ROWS_DROPPED warnings report actual remaining gaps.
            if (storedMerge!.instructions && (baseSkill.instructions || nonBaseSkill.instructions)) {
              const remediated = remediateTables({
                mergedInstructions: storedMerge!.instructions,
                baseInstructions: baseSkill.instructions,
                incomingInstructions: nonBaseSkill.instructions,
              });
              if (remediated.autoRecoveredRows > 0 && !remediated.growthRatioExceeded) {
                storedMerge = { ...storedMerge!, instructions: remediated.instructions };
                logger.info('skill_analyzer_table_remediation', {
                  candidateSlug: candidate.slug,
                  autoRecoveredRows: remediated.autoRecoveredRows,
                  skippedDueToColumnMismatch: remediated.skippedDueToColumnMismatch,
                  skippedDueToKeyConflict: remediated.skippedDueToKeyConflict,
                });
              }
              // Always strip [SOURCE: ...] annotations regardless of whether
              // rows were recovered — they are internal merge artifacts that
              // must never appear in the user-facing stored merge.
              // decontaminateSectionRows first removes rows appended into the
              // wrong section (cross-section table pollution); stripSourceAnnotations
              // then removes all remaining annotation markers.
              if (storedMerge!.instructions) {
                const decontaminated = decontaminateSectionRows(storedMerge!.instructions);
                const stripped = stripSourceAnnotations(decontaminated);
                if (stripped !== storedMerge!.instructions) {
                  storedMerge = { ...storedMerge!, instructions: stripped };
                }
              }
            }

            // Issue A remediation: if either source had an invocation block but
            // the merged output doesn't start with one, prepend the source's
            // canonical block. This handles the LLM case where the incoming
            // skill's persona opener displaces the library's invocation trigger.
            const sourceInvocation = baseInvocation ?? nonBaseInvocation;
            if (sourceInvocation && storedMerge!.instructions) {
              const mergedBlock = extractInvocationBlock(storedMerge!.instructions);
              const isAtTop = mergedBlock !== null
                && storedMerge!.instructions.trimStart().startsWith(mergedBlock.trimStart());
              if (!isAtTop) {
                // Fix 6 (v4): if the merged output opens with a persona statement
                // ("You are an expert…"), insert `---` separator so the invocation
                // trigger and the persona are visually distinct.
                const separator = startsWithPersonaOpener(storedMerge!.instructions)
                  ? '\n\n---\n\n'
                  : '\n\n';
                storedMerge = {
                  ...storedMerge!,
                  instructions: `${sourceInvocation.trimEnd()}${separator}${storedMerge!.instructions.trimStart()}`,
                };
                logger.info('skill_analyzer_invocation_block_prepended', {
                  candidateSlug: candidate.slug,
                  source: baseInvocation ? 'base' : 'nonBase',
                });
              }
            }

            mergeWarnings = validateMergeOutput(
              { definition: baseSkill.definition, instructions: baseSkill.instructions, invocationBlock: baseInvocation },
              { definition: nonBaseSkill.definition, instructions: nonBaseSkill.instructions, invocationBlock: nonBaseInvocation },
              storedMerge!,
              allLibraryNames,
              allLibrarySlugs,
              librarySkills,
              excludedId,
              validationThresholds,
              candidate.name,
            );

            // -----------------------------------------------------------------------
            // Consolidation gate (spec §5): fires when validateMergeOutput emits
            // SCOPE_EXPANSION or SCOPE_EXPANSION_CRITICAL. Single attempt, no retry.
            // Idempotency note: consolidationOutcome is an audit field, NOT an
            // idempotency guard. The per-slug skip in Stage 5 is the only guard.
            // -----------------------------------------------------------------------
            const consolidationEnabled = configSnapshot?.consolidationEnabled !== false; // default true
            const triggerSeverity = configSnapshot?.consolidationTriggerSeverity ?? 'warning';
            const hasScopeExpansion = mergeWarnings.some(w => w.code === 'SCOPE_EXPANSION' || w.code === 'SCOPE_EXPANSION_CRITICAL');
            const triggerFired =
              consolidationEnabled &&
              hasScopeExpansion &&
              !classifierFallbackApplied &&
              (triggerSeverity === 'warning' || mergeWarnings.some(w => w.code === 'SCOPE_EXPANSION_CRITICAL'));

            // SKILL-MERGE-RATIONALE-1: short-circuit when no rationale exists.
            // buildConsolidationPrompt feeds mergeRationale into the LLM context;
            // a null rationale leaves the prompt under-specified and the LLM call
            // is reliably rejected at parse time. Skipping avoids a wasted call
            // and a confusing "failed: parse_rejected" telemetry row.
            if (triggerFired && storedMerge && mergeRationale !== null) {
              // Cache pre-consolidation state for revert path (R2).
              const preConsolidationMergeWarnings = mergeWarnings.slice();
              slotPreConsolidationMerge = JSON.parse(JSON.stringify(storedMerge)) as ProposedMerge;

              const richerSourceWords = Math.max(
                consolidationWordCount(baseSkill.instructions),
                consolidationWordCount(nonBaseSkill.instructions),
              );
              const mergedWords = consolidationWordCount(storedMerge.instructions);
              const scopeExpansionStandardThreshold = configSnapshot?.scopeExpansionStandardThreshold ?? 0.40;

              const mergeForConsolidation = { ...storedMerge, mergeRationale: mergeRationale ?? undefined };
              const { system: consolidationSystem, userMessage: consolidationUserMessage } =
                buildConsolidationPrompt(mergeForConsolidation, richerSourceWords, mergedWords, scopeExpansionStandardThreshold);

              const consolidationAbort = new AbortController();
              const consolidationTimeoutId = setTimeout(
                () => consolidationAbort.abort('caller_timeout'),
                SKILL_CLASSIFY_TIMEOUT_MS,
              );

              let rawConsolidationContent: string | null = null;
              try {
                // SKILL-MERGE-BUDGET-1: verified 2026-05-17 against
                // server/services/llmRouter/routeCall.ts — `systemCallerPolicy:
                // 'bypass_routing'` only short-circuits provider/model
                // resolution. The atomic idempotency-and-budget reservation
                // block (§4+7) runs unconditionally, so consolidation calls
                // are counted against the per-org daily/monthly budget the
                // same as routed calls. No additional per-job cap needed.
                const consolidationResponse = await routeCall({
                  system: consolidationSystem,
                  messages: [{ role: 'user', content: consolidationUserMessage }],
                  maxTokens: 8192,
                  temperature: 0.1,
                  context: {
                    organisationId:     job.organisationId,
                    sourceType:         'analyzer',
                    sourceId:           jobId,
                    featureTag:         'skill-analyzer-consolidate',
                    taskType:           'general',
                    systemCallerPolicy: 'bypass_routing',
                    provider:           'anthropic',
                    model:              'claude-sonnet-4-6',
                  },
                  abortSignal: consolidationAbort.signal,
                  postProcess: (_content: string) => { /* pass-through; parse on caller side */ },
                });
                rawConsolidationContent = consolidationResponse.content;
              } catch (consolidationErr) {
                const code = (consolidationErr as { code?: string })?.code;
                const abortReason = (consolidationErr as { abortReason?: string })?.abortReason;
                const wasTimeout = code === 'CLIENT_DISCONNECTED' && abortReason === 'caller_timeout';
                const failureReason = wasTimeout ? 'timeout' : `llm_error: ${code ?? String(consolidationErr)}`;
                slotConsolidationOutcome = 'failed';
                slotConsolidationNote = null;
                mergeWarnings = preConsolidationMergeWarnings.slice();
                mergeWarnings.push({
                  code: 'CONSOLIDATION_FAILED',
                  severity: 'warning',
                  message: 'Tightening pass did not complete; reviewer is seeing the original merge.',
                  detail: JSON.stringify({ failureReason }),
                });
                logger.info('skill_analyzer_consolidation_outcome', {
                  jobId, slug: candidate.slug, outcome: 'failed', failureReason,
                });
              } finally {
                clearTimeout(consolidationTimeoutId);
              }

              if (rawConsolidationContent !== null) {
                const parseResult = parseConsolidationResponse(rawConsolidationContent, mergeForConsolidation);

                if ('reason' in parseResult) {
                  // Branch (2): typed parser rejection → failed
                  const failureReason = `parse_rejected: ${parseResult.reason}`;
                  slotConsolidationOutcome = 'failed';
                  slotConsolidationNote = null;
                  mergeWarnings = preConsolidationMergeWarnings.slice();
                  mergeWarnings.push({
                    code: 'CONSOLIDATION_FAILED',
                    severity: 'warning',
                    message: 'Tightening pass did not complete; reviewer is seeing the original merge.',
                    detail: JSON.stringify({ failureReason }),
                  });
                  logger.info('skill_analyzer_consolidation_parse_failure', {
                    jobId, slug: candidate.slug, reason: parseResult.reason,
                  });
                  logger.info('skill_analyzer_consolidation_outcome', {
                    jobId, slug: candidate.slug, outcome: 'failed', failureReason,
                  });
                } else if (parseResult.declinedToConsolidate) {
                  // Branch (3): LLM declined
                  slotConsolidationOutcome = 'declined';
                  slotConsolidationNote = parseResult.consolidationNote;
                  mergeWarnings.push({
                    code: 'CONSOLIDATION_DECLINED',
                    severity: 'warning',
                    message: 'AI reviewed this merge for tightening and judged it cannot be shortened without losing capability.',
                    detail: JSON.stringify({ declineReason: parseResult.declineReason }),
                  });
                  logger.info('skill_analyzer_consolidation_outcome', {
                    jobId, slug: candidate.slug, outcome: 'declined', declineReason: parseResult.declineReason,
                  });
                } else {
                  // Branch (4): provisional success — re-validate
                  const postConsolidationMerge = parseResult.consolidatedMerge;
                  const postWarnings = validateMergeOutput(
                    { definition: baseSkill.definition, instructions: baseSkill.instructions, invocationBlock: baseInvocation },
                    { definition: nonBaseSkill.definition, instructions: nonBaseSkill.instructions, invocationBlock: nonBaseInvocation },
                    postConsolidationMerge,
                    allLibraryNames,
                    allLibrarySlugs,
                    librarySkills,
                    excludedId,
                    validationThresholds,
                    candidate.name,
                  );

                  const newViolations = computeConsolidationViolations(preConsolidationMergeWarnings, postWarnings);

                  if (newViolations.length > 0) {
                    // Sub-revert: consolidation introduced hard-constraint violations
                    const failureReason = `hard_constraint_violation: ${newViolations.join(',')}`;
                    storedMerge = slotPreConsolidationMerge as unknown as StoredMerge;
                    mergeWarnings = preConsolidationMergeWarnings.slice();
                    slotConsolidationOutcome = 'failed';
                    slotConsolidationNote = null;
                    mergeWarnings.push({
                      code: 'CONSOLIDATION_FAILED',
                      severity: 'warning',
                      message: 'Tightening pass did not complete; reviewer is seeing the original merge.',
                      detail: JSON.stringify({ failureReason }),
                    });
                    logger.info('skill_analyzer_consolidation_outcome', {
                      jobId, slug: candidate.slug, outcome: 'failed', failureReason,
                    });
                  } else {
                    // Provisional success — enforce the spec's outcome-classification
                    // rule (§5 / §6 "Outcome classification rule"): `succeeded` requires
                    // the post-consolidation draft to be strictly shorter than the
                    // pre-consolidation draft. If the LLM returned a non-shortening
                    // payload with declinedToConsolidate=false, that's a protocol
                    // violation (the LLM ignored its self-check at §4.4) — revert to
                    // pre-consolidation and route to `failed` rather than emit
                    // misleading "0% shorter" / negative-reduction telemetry.
                    const preWords = consolidationWordCount(slotPreConsolidationMerge.instructions);
                    const postWords = consolidationWordCount(postConsolidationMerge.instructions);
                    const classification = classifyConsolidationOutcome(preWords, postWords);
                    if (classification.outcome === 'failed') {
                      const failureReason = classification.failureReason;
                      storedMerge = slotPreConsolidationMerge as unknown as StoredMerge;
                      mergeWarnings = preConsolidationMergeWarnings.slice();
                      slotConsolidationOutcome = 'failed';
                      slotConsolidationNote = null;
                      mergeWarnings.push({
                        code: 'CONSOLIDATION_FAILED',
                        severity: 'warning',
                        message: 'Tightening pass did not complete; reviewer is seeing the original merge.',
                        detail: JSON.stringify({ failureReason, preWords, postWords }),
                      });
                      logger.info('skill_analyzer_consolidation_outcome', {
                        jobId, slug: candidate.slug, outcome: 'failed', failureReason, preWords, postWords,
                      });
                    } else {
                      // Success — strip mergeRationale so jsonb columns retain four-field shape;
                      // the rationale already flows into its dedicated DB column via mergeRationale arg.
                      storedMerge = { ...postConsolidationMerge, mergeRationale: undefined } as StoredMerge;
                      mergeWarnings = postWarnings;
                      slotConsolidationOutcome = 'succeeded';
                      slotConsolidationNote = parseResult.consolidationNote;
                      const reductionPct = classification.reductionPct;
                      mergeWarnings.push({
                        code: 'CONSOLIDATION_APPLIED',
                        severity: 'warning',
                        message: `AI tightened the merge from ${preWords} to ${postWords} words (${reductionPct}% shorter).`,
                        detail: JSON.stringify({ preWords, postWords, reductionPct }),
                      });
                      logger.info('skill_analyzer_consolidation_outcome', {
                        jobId, slug: candidate.slug, outcome: 'succeeded', preWords, postWords,
                      });
                    }
                  }
                }
              }
            }
            // -----------------------------------------------------------------------
            // End consolidation gate. Downstream blocks (table recovery, output-format
            // recovery, classifier-fallback prepend, skill-graph collision, cross-ref
            // warnings) operate on the final storedMerge and mergeWarnings.
            // Stage 5b batch-cross-ref collision detection reads storedMerge which is
            // now the post-consolidation content — correct, because the reviewer sees
            // post-consolidation content too (R12).
            // -----------------------------------------------------------------------

            // Fix 2 (v4): append source tables as reference appendix when
            // tables were dropped (merged rows < 50% of source rows).
            if (storedMerge!.instructions) {
              const recovered = recoverDroppedTableRows(
                storedMerge!.instructions,
                baseSkill.instructions,
                nonBaseSkill.instructions,
              );
              if (recovered !== storedMerge!.instructions) {
                storedMerge = { ...storedMerge!, instructions: recovered };
                logger.info('skill_analyzer_table_drop_recovery', { candidateSlug: candidate.slug });
              }
            }

            // Fix 7 (v4): recover output format block when OUTPUT_FORMAT_LOST fires.
            if (
              storedMerge!.instructions &&
              mergeWarnings.some(w => w.code === 'OUTPUT_FORMAT_LOST')
            ) {
              const recovered = recoverOutputFormat(
                storedMerge!.instructions,
                baseSkill.instructions,
                nonBaseSkill.instructions,
              );
              if (recovered !== storedMerge!.instructions) {
                storedMerge = { ...storedMerge!, instructions: recovered };
                // Update warning text to indicate recovery happened.
                mergeWarnings = mergeWarnings.map(w =>
                  w.code === 'OUTPUT_FORMAT_LOST'
                    ? { ...w, message: 'Output format block was missing in merge. Recovered and appended as reference section.' }
                    : w,
                );
                logger.info('skill_analyzer_output_format_recovered', { candidateSlug: candidate.slug });
              }
            }

            // Prepend CLASSIFIER_FALLBACK when the rule-based path ran, so
            // the UI banner + approval gate both activate.
            if (classifierFallbackApplied) {
              mergeWarnings = [
                {
                  code: 'CLASSIFIER_FALLBACK',
                  severity: 'warning',
                  message: 'Rule-based fallback merge applied — classifier unavailable. Review carefully.',
                },
                ...mergeWarnings,
              ];
            }

            // v2 Fix 3: cross-library skill-graph collision detection.
            // Compares merged capabilities to every other library skill
            // (top-K bigram pre-filter + hard pair budget).
            const collisions = detectSkillGraphCollision({
              merged: storedMerge!,
              libraryCatalog: librarySkills.map(s => ({
                id: s.id,
                slug: s.slug,
                name: s.name,
                instructions: s.instructions,
              })),
              excludedId: matchedLib.id ?? null,
            });
            for (const c of collisions) {
              mergeWarnings.push({
                code: 'SKILL_GRAPH_COLLISION',
                severity: 'warning',
                message: `Merged skill overlaps ~${Math.round(c.overlapRatio * 100)}% with "${c.collidingName}".`,
                detail: JSON.stringify({
                  collidingSkillId: c.collidingSkillId,
                  collidingSlug: c.collidingSlug,
                  collidingName: c.collidingName,
                  overlapRatio: c.overlapRatio,
                  overlappingFragments: c.overlappingFragments,
                }),
              });
            }

            // v6 Fix 5: informational warning when an incoming skill cross-
            // references the matched library skill but similarity is ≥ 70%, so
            // the merge is kept. Reviewer should know the incoming was
            // designed to live alongside the library skill.
            if (crossRefKeptAsPartialOverlap) {
              mergeWarnings.push({
                code: 'CROSS_REFERENCES_DISTINCT',
                severity: 'warning',
                message: `This skill cross-references "${matchedLib.name}" as a separate tool, but similarity (${Math.round((match.similarity ?? 0) * 100)}%) was high enough to keep the merge. Review whether the two should remain distinct.`,
              });
            }

            if (mergeWarnings.length > 0) {
              console.info('[SkillAnalyzer] merge_warnings_summary', {
                candidateSlug: candidate.slug,
                codes: mergeWarnings.map(w => w.code),
                classifierFallbackApplied,
              });
            }
          }

          // v6 Fix 4: calibrate the classifier's self-reported confidence with
          // structural signals from validation. Applied after all warnings are
          // computed so the adjustment sees REQUIRED_FIELD_DEMOTED field
          // counts, SOURCE_FORK membership, table drop / restructure state,
          // and self-referencing Related Skills sections.
          const adjustedConfidence = skillAnalyzerServicePure.adjustClassifierConfidence(
            finalResult.confidence,
            mergeWarnings,
            {
              mergedInstructions: storedMerge?.instructions ?? null,
              mergedName: storedMerge?.name ?? candidate.name,
              candidateSlug: candidate.slug,
              librarySlug: matchedLib.slug,
            },
          );
          finalResult = { ...finalResult, confidence: adjustedConfidence };

          classifiedResults.push({
            candidateIndex: match.candidateIndex,
            candidate,
            classification: finalResult.classification,
            confidence: finalResult.confidence,
            similarityScore: match.similarity,
            classificationReasoning: finalResult.reasoning,
            libraryId: matchedLib.id,
            librarySlug: matchedLib.slug,
            libraryName: matchedLib.name,
            diffSummary,
            proposedMerge: storedMerge ?? null,
            classificationFailed,
            classificationFailureReason,
          });

          // Write result immediately — don't wait for Stage 8.
          // unmarkSkillInFlight is in finally so it always runs even if the
          // DB insert throws, preventing a permanently stale in-flight record.
          try {
            const flags = nonSkillFlagsByIndex.get(match.candidateIndex);
            await insertSingleResult({
              jobId,
              candidateIndex: match.candidateIndex,
              candidateName: candidate.name,
              candidateSlug: candidate.slug,
              candidateContentHash: getCandidateHash(match.candidateIndex),
              matchedSkillId: matchedLib.id ?? undefined,
              classification: finalResult.classification,
              confidence: finalResult.confidence,
              similarityScore: match.similarity ?? undefined,
              classificationReasoning: finalResult.reasoning ?? undefined,
              diffSummary: diffSummary ?? undefined,
              proposedMergedContent: storedMerge ?? undefined,
              originalProposedMerge: storedMerge ?? undefined,
              mergeWarnings: mergeWarnings.length > 0 ? mergeWarnings : null,
              mergeRationale: mergeRationale,
              classifierFallbackApplied,
              classificationFailed,
              classificationFailureReason: classificationFailureReason ?? null,
              isDocumentationFile: flags?.isDocumentationFile ?? false,
              isContextFile: flags?.isContextFile ?? false,
              preConsolidationMerge: slotPreConsolidationMerge ?? undefined,
              consolidationOutcome: slotConsolidationOutcome,
              consolidationNote: slotConsolidationNote ?? undefined,
            });
          } finally {
            // Wrap unmark in its own try/catch — if it throws, the error must
            // not propagate out of finally and abort the entire Promise.all.
            try {
              await unmarkSkillInFlight(jobId, candidate.slug);
            } catch (unmarkErr) {
              console.error('[SkillAnalyzer] unmarkSkillInFlight failed', {
                jobId,
                slug: candidate.slug,
                unmarkErr,
              });
            }

            console.log('[SkillAnalyzer] classify:end', {
              jobId,
              slug: candidate.slug,
              durationMs: Date.now() - startMs,
              classification: finalResult.classification,
              failed: classificationFailed,
              failureReason: classificationFailureReason ?? undefined,
            });
          }

          classifiedCount++;
          const pct = 60 + Math.round((classifiedCount / llmQueue.length) * 30);
          await updateJobProgress(jobId, {
            progressPct: Math.min(pct, 89),
            progressMessage: `Classified ${classifiedCount} / ${llmQueue.length}...`,
          });
        })
      )
    );
  }

  return { ...ctx, classifiedResults, completedCandidateIndices };
}
