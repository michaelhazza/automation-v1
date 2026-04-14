/**
 * Skill Analyzer Job — pg-boss handler for the 'skill-analyzer' queue.
 *
 * Executes the 6-stage pipeline:
 *   Stage 1: Parse    (0%  → 10%)
 *   Stage 2: Hash     (10% → 20%)
 *   Stage 3: Embed    (20% → 40%)
 *   Stage 4: Compare  (40% → 60%)
 *   Stage 5: Classify (60% → 90%)
 *   Stage 6: Write    (90% → 100%)
 *
 * Idempotent: deletes existing results before re-processing on retry.
 * Max 1 retry with 5-minute delay on crash.
 */

import { generateEmbeddings } from '../lib/embeddings.js';
import { withBackoff } from '../lib/withBackoff.js';
import { env } from '../lib/env.js';
import { skillParserService } from '../services/skillParserService.js';
import { skillEmbeddingService } from '../services/skillEmbeddingService.js';
import { systemSkillService } from '../services/systemSkillService.js';
// Phase 1 of skill-analyzer-v2: the analyzer is system-only. The org-skill
// library read path was removed; all dedup comparisons happen against
// system_skills via systemSkillService.listSkills() (which returns all rows
// regardless of isActive / visibility, so retired skills still participate
// in dedup detection — see spec §10 Phase 0 listSkills() contract).
import {
  updateJobProgress,
  getJobById,
  clearResultsForJob,
  insertResults,
  insertSingleResult,
  markSkillInFlight,
  unmarkSkillInFlight,
  updateResultAgentProposals,
} from '../services/skillAnalyzerService.js';
import { SKILL_CLASSIFY_TIMEOUT_MS } from '../config/limits.js';
import type { skillAnalyzerResults } from '../db/schema/index.js';
import {
  skillAnalyzerServicePure,
  LibrarySkillSummary,
} from '../services/skillAnalyzerServicePure.js';
import {
  skillParserServicePure,
  ParsedSkill,
} from '../services/skillParserServicePure.js';
import anthropicAdapter from '../services/providers/anthropicAdapter.js';
import { logger } from '../lib/logger.js';

// p-limit is ESM; import dynamically to avoid CommonJS issues
async function getPLimit(concurrency: number) {
  const { default: pLimit } = await import('p-limit');
  return pLimit(concurrency);
}

const BATCH_SIZE = 100; // OpenAI embedding batch size

/** Process a skill analyzer job through all pipeline stages. */
export async function processSkillAnalyzerJob(jobId: string): Promise<void> {
  // Load job via service (no direct DB access in jobs)
  const job = await getJobById(jobId);
  if (!job) {
    console.error(`[SkillAnalyzerJob] Job ${jobId} not found`);
    return;
  }

  const organisationId = job.organisationId;

  // Idempotent: clear any prior results (support for retries)
  await clearResultsForJob(jobId);

  // -------------------------------------------------------------------------
  // Stage 1: Parse (0% → 10%)
  // -------------------------------------------------------------------------
  await updateJobProgress(jobId, {
    status: 'parsing',
    progressPct: 0,
    progressMessage: 'Parsing skill definitions...',
  });

  let candidates: ParsedSkill[];

  try {
    if (job.sourceType === 'paste' || job.sourceType === 'upload') {
      // Candidates were parsed at job creation and stored as JSONB
      candidates = (job.parsedCandidates as ParsedSkill[]) || [];
    } else if (job.sourceType === 'github') {
      const githubMeta = job.sourceMetadata as { url: string };
      candidates = await skillParserService.parseFromGitHub(githubMeta.url);
    } else if (job.sourceType === 'download') {
      const downloadMeta = job.sourceMetadata as { url: string };
      candidates = await skillParserService.parseFromDownloadUrl(downloadMeta.url);
    } else {
      candidates = [];
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateJobProgress(jobId, {
      status: 'failed',
      errorMessage: `Failed to parse skills: ${msg}`,
    });
    return;
  }

  if (candidates.length === 0) {
    await updateJobProgress(jobId, {
      status: 'failed',
      errorMessage: 'No valid skill definitions found in the provided input.',
    });
    return;
  }

  // Enforce 500-candidate limit
  if (candidates.length > 500) {
    candidates = candidates.slice(0, 500);
  }

  await updateJobProgress(jobId, {
    progressPct: 10,
    progressMessage: `Found ${candidates.length} skill${candidates.length === 1 ? '' : 's'} - checking for exact duplicates...`,
    candidateCount: candidates.length,
    // Store (possibly freshly parsed) candidates for display/replay
    parsedCandidates: candidates,
  });

  // -------------------------------------------------------------------------
  // Stage 2: Hash (10% → 20%)
  // -------------------------------------------------------------------------
  await updateJobProgress(jobId, {
    status: 'hashing',
    progressPct: 10,
    progressMessage: 'Computing content hashes...',
  });

  // Load all library skills from system_skills. listSkills() returns every
  // row regardless of isActive / visibility so retired skills still
  // participate in dedup. See spec §10 Phase 0 listSkills() contract.
  const systemSkillRows = await systemSkillService.listSkills();

  const librarySkills: LibrarySkillSummary[] = systemSkillRows.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    description: s.description,
    definition: s.definition as object | null,
    instructions: s.instructions,
    // isSystem is now always true (the analyzer is system-only post Phase 1).
    // Field kept for backwards compatibility with the LibrarySkillSummary
    // type used by skillAnalyzerServicePure helpers.
    isSystem: true,
  }));

  // Compute candidate hashes
  const candidateHashes = candidates.map((c) =>
    skillParserServicePure.contentHash(skillParserServicePure.normalizeForHash(c))
  );

  // Compute library hashes
  const libraryHashMap = new Map<string, LibrarySkillSummary>();
  for (const lib of librarySkills) {
    const libAsCandidate: ParsedSkill = {
      name: lib.name,
      slug: lib.slug,
      description: lib.description,
      definition: lib.definition,
      instructions: lib.instructions,
      rawSource: '',
    };
    const hash = skillParserServicePure.contentHash(skillParserServicePure.normalizeForHash(libAsCandidate));
    libraryHashMap.set(hash, lib);
  }

  // Find exact duplicates
  type ExactDuplicateResult = {
    candidateIndex: number;
    matchedLib: LibrarySkillSummary;
  };
  const exactDuplicates: ExactDuplicateResult[] = [];
  const remainingCandidates: Array<{ index: number; candidate: ParsedSkill; hash: string }> = [];

  // Also deduplicate candidates within the batch (same hash → only first one proceeds)
  const seenCandidateHashes = new Map<string, number>();

  for (let i = 0; i < candidates.length; i++) {
    const hash = candidateHashes[i];
    const candidate = candidates[i];
    const libMatch = libraryHashMap.get(hash);

    if (libMatch) {
      exactDuplicates.push({ candidateIndex: i, matchedLib: libMatch });
    } else if (seenCandidateHashes.has(hash)) {
      // Intra-batch duplicate — classify same as first occurrence (resolved later)
      // For now, mark as exact duplicate pointing to the same candidate
      exactDuplicates.push({ candidateIndex: i, matchedLib: {
        id: null,
        slug: candidate.slug,
        name: `${candidate.name} (duplicate in import)`,
        description: candidate.description,
        definition: candidate.definition,
        instructions: candidate.instructions,
          isSystem: false,
      }});
    } else {
      seenCandidateHashes.set(hash, i);
      remainingCandidates.push({ index: i, candidate, hash });
    }
  }

  await updateJobProgress(jobId, {
    progressPct: 20,
    progressMessage: `${exactDuplicates.length} exact duplicate${exactDuplicates.length === 1 ? '' : 's'} found - embedding ${remainingCandidates.length} remaining...`,
    exactDuplicateCount: exactDuplicates.length,
  });

  // Helper: look up the SHA-256 hash for a given candidate index. Defined
  // here (after Stage 2) so it is available in Stage 5's incremental inserts
  // as well as Stage 8's batch writes. The hash is computed in Stage 2 and
  // persisted on each result row for the Phase 4 manual-add PATCH path.
  const hashByIndex = new Map<number, string>();
  for (let i = 0; i < candidates.length; i++) {
    hashByIndex.set(i, candidateHashes[i]);
  }
  const getCandidateHash = (idx: number): string => {
    const h = hashByIndex.get(idx);
    if (h === undefined) {
      // Should be unreachable — every candidate is hashed in Stage 2.
      throw new Error(`candidateContentHash missing for candidateIndex=${idx}`);
    }
    return h;
  };

  // -------------------------------------------------------------------------
  // Stage 3: Embed (20% → 40%)
  // -------------------------------------------------------------------------
  await updateJobProgress(jobId, {
    status: 'embedding',
    progressPct: 20,
    progressMessage: 'Generating embeddings...',
  });

  // Gather all content needing embeddings (candidates + library skills)
  type EmbedItem = {
    key: string; // content hash
    text: string; // normalized content
    sourceType: 'candidate' | 'system' | 'org';
    sourceIdentifier: string;
  };

  const toEmbed: EmbedItem[] = [];

  // Remaining candidates
  for (const { index, candidate, hash } of remainingCandidates) {
    toEmbed.push({
      key: hash,
      text: skillParserServicePure.normalizeForHash(candidate),
      sourceType: 'candidate',
      sourceIdentifier: `job:${jobId}:idx:${index}`,
    });
  }

  // Library skills (check cache first)
  const libEmbedItems: EmbedItem[] = librarySkills.map((lib) => {
    const libAsCandidate: ParsedSkill = {
      name: lib.name, slug: lib.slug, description: lib.description,
      definition: lib.definition, instructions: lib.instructions,
      rawSource: '',
    };
    const hash = skillParserServicePure.contentHash(skillParserServicePure.normalizeForHash(libAsCandidate));
    return {
      key: hash,
      text: skillParserServicePure.normalizeForHash(libAsCandidate),
      sourceType: lib.isSystem ? 'system' as const : 'org' as const,
      sourceIdentifier: lib.isSystem ? lib.slug : (lib.id ?? lib.slug),
    };
  });

  // Check cache for all items
  const allHashes = [...toEmbed, ...libEmbedItems].map((e) => e.key);
  const cachedEmbeddings = await skillEmbeddingService.getByContentHashes(allHashes);

  // Filter to uncached items only
  const uncachedItems = [...toEmbed, ...libEmbedItems].filter(
    (e) => !cachedEmbeddings.has(e.key)
  );

  // Deduplicate uncached items by key
  const uniqueUncached = Array.from(new Map(uncachedItems.map((e) => [e.key, e])).values());

  if (uniqueUncached.length > 0) {
    // Batch embed in groups of BATCH_SIZE
    const embeddingFallback = !env.OPENAI_API_KEY;

    if (!embeddingFallback) {
      for (let i = 0; i < uniqueUncached.length; i += BATCH_SIZE) {
        const batch = uniqueUncached.slice(i, i + BATCH_SIZE);
        const texts = batch.map((e) => e.text);

        const embeddings = await generateEmbeddings(texts);

        if (embeddings) {
          const storeBatch = embeddings.map((embedding, idx) => ({
            contentHash: batch[idx].key,
            sourceType: batch[idx].sourceType,
            sourceIdentifier: batch[idx].sourceIdentifier,
            embedding,
          }));
          await skillEmbeddingService.storeBatch(storeBatch);

          // Add to local cache map
          for (let j = 0; j < storeBatch.length; j++) {
            cachedEmbeddings.set(storeBatch[j].contentHash, embeddings[j]);
          }
        }

        const pct = 20 + Math.round((Math.min(i + BATCH_SIZE, uniqueUncached.length) / uniqueUncached.length) * 20);
        await updateJobProgress(jobId, {
          progressPct: pct,
          progressMessage: `Embedded ${Math.min(i + BATCH_SIZE, uniqueUncached.length)} / ${uniqueUncached.length} skills...`,
        });
      }
    } else {
      console.warn('[SkillAnalyzerJob] OPENAI_API_KEY not set - skipping embeddings, all pairs treated as ambiguous');
    }
  }

  // -------------------------------------------------------------------------
  // Stage 4: Compare (40% → 60%)
  // -------------------------------------------------------------------------
  await updateJobProgress(jobId, {
    status: 'comparing',
    progressPct: 40,
    progressMessage: 'Computing similarity scores...',
  });

  // Build embedding arrays for comparison
  const candidateEmbeddingsForCompare = remainingCandidates
    .map(({ index, hash }) => {
      const embedding = cachedEmbeddings.get(hash);
      return embedding ? { index, embedding } : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const libraryEmbeddingsForCompare = librarySkills
    .map((lib) => {
      const libAsCandidate: ParsedSkill = {
        name: lib.name, slug: lib.slug, description: lib.description,
        definition: lib.definition, instructions: lib.instructions,
        rawSource: '',
      };
      const hash = skillParserServicePure.contentHash(skillParserServicePure.normalizeForHash(libAsCandidate));
      const embedding = cachedEmbeddings.get(hash);
      return embedding ? { id: lib.id, slug: lib.slug, name: lib.name, embedding } : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  type BestMatch = {
    candidateIndex: number;
    libraryId: string | null;
    librarySlug: string | null;
    libraryName: string | null;
    similarity: number;
    band: 'likely_duplicate' | 'ambiguous' | 'distinct';
  };

  let bestMatches: BestMatch[];
  if (candidateEmbeddingsForCompare.length > 0 && libraryEmbeddingsForCompare.length > 0) {
    bestMatches = skillAnalyzerServicePure.computeBestMatches(
      candidateEmbeddingsForCompare,
      libraryEmbeddingsForCompare
    );
  } else {
    // No embeddings available — treat all as ambiguous
    bestMatches = remainingCandidates.map(({ index }) => ({
      candidateIndex: index,
      libraryId: null,
      librarySlug: null,
      libraryName: null,
      similarity: 0.75, // midpoint of ambiguous band
      band: 'ambiguous' as const,
    }));
  }

  // Ensure candidates whose embeddings failed are treated as ambiguous rather than silently dropped.
  // Try to find a tentative library match by slug so the LLM can properly classify them.
  const matchedIndices = new Set(bestMatches.map((m) => m.candidateIndex));
  for (const { index, candidate } of remainingCandidates) {
    if (!matchedIndices.has(index)) {
      // Find best slug/name match from library for LLM classification
      const slugMatch = librarySkills.find((lib) => lib.slug === candidate.slug);
      const nameMatch = !slugMatch ? librarySkills.find((lib) =>
        lib.name.toLowerCase() === candidate.name.toLowerCase()
      ) : null;
      const tentativeMatch = slugMatch ?? nameMatch ?? null;
      bestMatches.push({
        candidateIndex: index,
        libraryId: tentativeMatch?.id ?? null,
        librarySlug: tentativeMatch?.slug ?? null,
        libraryName: tentativeMatch?.name ?? null,
        similarity: 0.75,
        band: 'ambiguous' as const,
      });
    }
  }

  const distinctResults = bestMatches.filter((m) => m.band === 'distinct');
  // TODO: remove this cap once full-instructions merge is validated in testing.
  // Limits LLM classification to 3 skills to reduce token cost during QA.
  const LLM_QUEUE_CAP = 3;
  const llmQueue = bestMatches.filter((m) => m.band !== 'distinct').slice(0, LLM_QUEUE_CAP);

  await updateJobProgress(jobId, {
    progressPct: 60,
    progressMessage: `${distinctResults.length} distinct, ${llmQueue.length} need classification...`,
    comparisonCount: bestMatches.length,
  });

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
  const classificationFallback = !env.ANTHROPIC_API_KEY;

  await updateJobProgress(jobId, {
    status: 'classifying',
    progressPct: 60,
    progressMessage: classificationFallback
      ? 'LLM classification unavailable - marking candidates for human review...'
      : 'Classifying with AI...',
    classifyState: {
      queue: llmQueue.map((m) => candidates[m.candidateIndex].slug),
      inFlight: {},
    },
  });

  type ClassifiedResult = {
    candidateIndex: number;
    candidate: ParsedSkill;
    classification: 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';
    confidence: number;
    similarityScore: number | null;
    classificationReasoning: string | null;
    libraryId: string | null;
    librarySlug: string | null;
    libraryName: string | null;
    diffSummary: object | null;
    // Phase 3 of skill-analyzer-v2: LLM-generated merged version of the
    // candidate + library skill, populated only when the classifier
    // returns a valid proposedMerge for a PARTIAL_OVERLAP / IMPROVEMENT
    // result. Null on every other path. The Write stage persists this
    // into both proposed_merged_content (mutable) and
    // original_proposed_merge (immutable) on the result row.
    proposedMerge: object | null;
    classificationFailed: boolean;
    classificationFailureReason: 'rate_limit' | 'parse_error' | 'timed_out' | 'unknown' | null;
  };

  const classifiedResults: ClassifiedResult[] = [];

  // Build a lookup for library skills by slug
  const libraryBySlug = new Map<string, LibrarySkillSummary>(
    librarySkills.map((lib) => [lib.slug, lib])
  );

  if (classificationFallback) {
    console.warn(
      '[SkillAnalyzerJob] ANTHROPIC_API_KEY not set - skipping LLM classification; all ambiguous pairs routed to PARTIAL_OVERLAP for human review'
    );

    for (const match of llmQueue) {
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
        });
        continue;
      }

      const diffSummary = skillAnalyzerServicePure.generateDiffSummary(candidate, matchedLib);
      classifiedResults.push({
        candidateIndex: match.candidateIndex,
        candidate,
        classification: 'PARTIAL_OVERLAP',
        confidence: 0.3,
        similarityScore: match.similarity,
        classificationReasoning:
          'LLM classification unavailable (ANTHROPIC_API_KEY not configured) - routed for human review.',
        libraryId: matchedLib.id,
        librarySlug: matchedLib.slug,
        libraryName: matchedLib.name,
        diffSummary,
        // No LLM = no merge proposal. Row will fail the null guard on
        // execute (spec §6.3 LLM-fallback path).
        proposedMerge: null,
        classificationFailed: false,
        classificationFailureReason: null,
      });
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
          'LLM classification unavailable (ANTHROPIC_API_KEY not configured) - routed for human review.',
        diffSummary: diffSummary ?? undefined,
        classificationFailed: false,
        classificationFailureReason: null,
      });
    }

    await updateJobProgress(jobId, {
      progressPct: 89,
      progressMessage: `Routed ${llmQueue.length} candidate${llmQueue.length === 1 ? '' : 's'} to human review (LLM unavailable)`,
    });
  } else {
    // Concurrency 3: reduces Anthropic API rate-limit pressure. Each call
    // may generate a large proposedMerge response; 5 concurrent requests
    // was causing sustained rate limiting and cascading timeouts.
    const limit = await getPLimit(3);
    let classifiedCount = 0;

    await Promise.all(
      llmQueue.map((match) =>
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
            });
            return;
          }

          const startMs = Date.now();
          console.log('[SkillAnalyzer] classify:start', {
            jobId,
            slug: candidate.slug,
            candidateIndex: match.candidateIndex,
          });
          await markSkillInFlight(jobId, candidate.slug, startMs);

          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(Object.assign(new Error('LLM classify timed out'), { code: 'CLASSIFY_TIMEOUT' })),
              SKILL_CLASSIFY_TIMEOUT_MS,
            )
          );

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

          // Sentinel thrown inside withBackoff when the LLM response is
          // structurally valid JSON but fails our schema check. Marked
          // retryable so the model gets another attempt.
          const PARSE_FAILURE = { code: 'CLASSIFICATION_PARSE_FAILURE' } as const;

          try {
            classificationResult = await Promise.race([
              withBackoff(
                async () => {
                  const response = await anthropicAdapter.call({
                    model: 'claude-sonnet-4-6',
                    system,
                    messages: [{ role: 'user', content: userMessage }],
                    // 8192 is the Sonnet 4.6 output ceiling — ensures proposedMerge
                    // with long instructions can never be truncated.
                    maxTokens: 8192,
                    temperature: 0.1,
                  });
                  const parsed = skillAnalyzerServicePure.parseClassificationResponseWithMerge(response.content);
                  if (parsed === null) {
                    logger.warn('skill_classify_parse_failure', {
                      jobId,
                      slug: candidate.slug,
                      rawLength: response.content.length,
                      // Full raw response so we can see exactly what the LLM produced
                      raw: response.content,
                    });
                    throw PARSE_FAILURE;
                  }
                  return parsed;
                },
                {
                  label: `skill-classify-${match.candidateIndex}`,
                  maxAttempts: 3,
                  correlationId: jobId,
                  runId: jobId,
                  isRetryable: (err: unknown) => {
                    // Parse failures: model produced unparseable output — worth retrying.
                    if (err === PARSE_FAILURE) return true;
                    // PROVIDER_NOT_CONFIGURED is not retryable — the configuration
                    // cannot change between attempts, so retrying just wastes time.
                    const e = err as { statusCode?: number; code?: string };
                    if (e?.code === 'PROVIDER_NOT_CONFIGURED') return false;
                    if (e?.code === 'CLASSIFY_TIMEOUT') return false;
                    return (
                      e?.statusCode === 429 ||
                      e?.statusCode === 503 ||
                      e?.statusCode === 529 ||
                      e?.code === 'PROVIDER_UNAVAILABLE'
                    );
                  },
                }
              ),
              timeoutPromise,
            ]);
          } catch (err) {
            classificationResult = null;
            classificationApiError = err === PARSE_FAILURE ? undefined : err;
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

          // Fallback: classification failed entirely (LLM error or
          // unparseable output). Tag the row as PARTIAL_OVERLAP for human
          // review with a null merge — execute will fail the null guard
          // with the spec's standard "merge proposal unavailable" error.
          const finalResult = classificationResult ?? {
            classification: 'PARTIAL_OVERLAP' as const,
            confidence: 0.3,
            reasoning: 'LLM classification failed - defaulting to PARTIAL_OVERLAP for human review.',
            proposedMerge: null,
          };

          const diffSummary = skillAnalyzerServicePure.generateDiffSummary(candidate, matchedLib);

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
            proposedMerge: finalResult.proposedMerge ?? null,
            classificationFailed,
            classificationFailureReason,
          });

          // Write result immediately — don't wait for Stage 8.
          // unmarkSkillInFlight is in finally so it always runs even if the
          // DB insert throws, preventing a permanently stale in-flight record.
          try {
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
              proposedMergedContent: finalResult.proposedMerge ?? undefined,
              originalProposedMerge: finalResult.proposedMerge ?? undefined,
              classificationFailed,
              classificationFailureReason: classificationFailureReason ?? null,
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

  // -------------------------------------------------------------------------
  // Stage 6: Agent-embed (75% → 80%) — Phase 2 of skill-analyzer-v2
  // -------------------------------------------------------------------------
  // Refresh embeddings for every active system agent. Lazy invalidation:
  // anything whose stored content_hash matches the live hash is a cache hit
  // and skipped. See spec §6 Pipeline + agentEmbeddingService.
  await updateJobProgress(jobId, {
    progressPct: 75,
    progressMessage: 'Refreshing system agent embeddings...',
  });

  const { agentEmbeddingService } = await import('../services/agentEmbeddingService.js');
  const { systemAgentService } = await import('../services/systemAgentService.js');

  await agentEmbeddingService.refreshSystemAgentEmbeddings();

  // -------------------------------------------------------------------------
  // Stage 7: Agent-propose (80% → 90%) — Phase 2 of skill-analyzer-v2
  // -------------------------------------------------------------------------
  // For every DISTINCT result, compute cosine similarity against every
  // system agent embedding and write the top-K=3 to agent_proposals on
  // the result row. The threshold drives pre-selection only — top-K is
  // always persisted in full so reviewers can promote a below-threshold
  // chip with one click. See spec §6.2.
  await updateJobProgress(jobId, {
    progressPct: 80,
    progressMessage: 'Proposing system agent attachments...',
  });

  // Pre-load every active system agent + its cached embedding into a
  // single in-memory list so the per-result loop is just N cosine
  // computations. Zero-agents edge case: empty list → empty proposals.
  const allSystemAgents = await systemAgentService.listAgents();
  const rankableAgents: Array<{
    systemAgentId: string;
    slug: string;
    name: string;
    embedding: number[];
  }> = [];
  for (const agent of allSystemAgents) {
    const embRow = await agentEmbeddingService.getAgentEmbedding(agent.id);
    if (embRow) {
      rankableAgents.push({
        systemAgentId: agent.id,
        slug: agent.slug,
        name: agent.name,
        embedding: embRow.embedding,
      });
    }
  }

  // Compute proposals for every DISTINCT result. Indexed by candidateIndex
  // so the Write stage below can look them up alongside the existing result
  // row data.
  const agentProposalsByCandidateIndex = new Map<
    number,
    ReturnType<typeof skillAnalyzerServicePure.rankAgentsForCandidate>
  >();

  if (rankableAgents.length > 0) {
    for (const distinctMatch of distinctResults) {
      const candidateEmbedding = candidateEmbeddingsForCompare.find(
        (c) => c.index === distinctMatch.candidateIndex,
      )?.embedding;
      if (!candidateEmbedding) continue;
      const proposals = skillAnalyzerServicePure.rankAgentsForCandidate(
        candidateEmbedding,
        rankableAgents,
      );
      agentProposalsByCandidateIndex.set(distinctMatch.candidateIndex, proposals);
    }
    // Also propose for any LLM-classified result that landed on DISTINCT.
    for (const r of classifiedResults) {
      if (r.classification !== 'DISTINCT') continue;
      const candidateEmbedding = candidateEmbeddingsForCompare.find(
        (c) => c.index === r.candidateIndex,
      )?.embedding;
      if (!candidateEmbedding) continue;
      const proposals = skillAnalyzerServicePure.rankAgentsForCandidate(
        candidateEmbedding,
        rankableAgents,
      );
      agentProposalsByCandidateIndex.set(r.candidateIndex, proposals);
    }
  }

  // -------------------------------------------------------------------------
  // Stage 8: Write Results (90% → 100%)
  // -------------------------------------------------------------------------
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
    });
  }

  // Distinct from Stage 4
  for (const m of distinctResults) {
    const candidate = candidates[m.candidateIndex];
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
    });
  }

  // Insert via service (avoids direct db import in jobs)
  await insertResults(resultRows);

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

  await updateJobProgress(jobId, {
    status: 'completed',
    progressPct: 100,
    progressMessage: `Analysis complete - ${candidates.length} result${candidates.length === 1 ? '' : 's'}.`,
    completedAt: new Date(),
  });
}
