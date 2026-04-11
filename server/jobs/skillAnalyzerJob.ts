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
} from '../services/skillAnalyzerService.js';
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
  const llmQueue = bestMatches.filter((m) => m.band !== 'distinct');

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

      if (!matchedLib || !candidate) {
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
        });
        continue;
      }

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
        diffSummary: skillAnalyzerServicePure.generateDiffSummary(candidate, matchedLib),
      });
    }

    await updateJobProgress(jobId, {
      progressPct: 89,
      progressMessage: `Routed ${llmQueue.length} candidate${llmQueue.length === 1 ? '' : 's'} to human review (LLM unavailable)`,
    });
  } else {
    const limit = await getPLimit(5);
    let classifiedCount = 0;

    await Promise.all(
      llmQueue.map((match) =>
        limit(async () => {
          const candidate = candidates[match.candidateIndex];
          const matchedLib = match.librarySlug ? libraryBySlug.get(match.librarySlug) : null;

          if (!matchedLib || !candidate) {
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
            });
            return;
          }

          const { system, userMessage } = skillAnalyzerServicePure.buildClassificationPrompt(
            candidate,
            matchedLib,
            match.band as 'likely_duplicate' | 'ambiguous'
          );

          let classificationResult: ReturnType<typeof skillAnalyzerServicePure.parseClassificationResponse>;

          try {
            const response = await withBackoff(
              () =>
                anthropicAdapter.call({
                  model: 'claude-haiku-4-5-20251001',
                  system,
                  messages: [{ role: 'user', content: userMessage }],
                  maxTokens: 512,
                  temperature: 0.1,
                }),
              {
                label: `skill-classify-${match.candidateIndex}`,
                maxAttempts: 3,
                correlationId: jobId,
                runId: jobId,
                // PROVIDER_NOT_CONFIGURED is not retryable — the configuration
                // cannot change between attempts, so retrying just wastes time.
                // Retry only transient upstream failures.
                isRetryable: (err: unknown) => {
                  const e = err as { statusCode?: number; code?: string };
                  if (e?.code === 'PROVIDER_NOT_CONFIGURED') return false;
                  return (
                    e?.statusCode === 503 ||
                    e?.statusCode === 529 ||
                    e?.code === 'PROVIDER_UNAVAILABLE'
                  );
                },
              }
            );

            classificationResult = skillAnalyzerServicePure.parseClassificationResponse(response.content);
          } catch {
            classificationResult = null;
          }

          const finalResult = classificationResult ?? {
            classification: 'PARTIAL_OVERLAP' as const,
            confidence: 0.3,
            reasoning: 'LLM classification failed - defaulting to PARTIAL_OVERLAP for human review.',
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
          });

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
  // Stage 6: Write Results (90% → 100%)
  // -------------------------------------------------------------------------
  await updateJobProgress(jobId, {
    progressPct: 90,
    progressMessage: 'Writing results...',
  });

  // Collect all result rows
  const resultRows: (typeof skillAnalyzerResults.$inferInsert)[] = [];

  // Helper: look up the SHA-256 hash for a given candidate index. The hash
  // is computed in Stage 2 (Hash) and was originally only used for dedup.
  // Phase 1 of skill-analyzer-v2 persists it on the result row so the Phase 4
  // manual-add PATCH can look up the candidate embedding in skill_embeddings
  // by content hash without recomputing it. See spec §5.2 candidateContentHash.
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
    });
  }

  // LLM-classified from Stage 5
  for (const r of classifiedResults) {
    resultRows.push({
      jobId,
      candidateIndex: r.candidateIndex,
      candidateName: r.candidate.name,
      candidateSlug: r.candidate.slug,
      candidateContentHash: getCandidateHash(r.candidateIndex),
      matchedSkillId: r.libraryId ?? undefined,
      classification: r.classification,
      confidence: r.confidence,
      similarityScore: r.similarityScore ?? undefined,
      classificationReasoning: r.classificationReasoning ?? undefined,
      diffSummary: r.diffSummary ?? undefined,
    });
  }

  // Insert via service (avoids direct db import in jobs)
  await insertResults(resultRows);

  await updateJobProgress(jobId, {
    status: 'completed',
    progressPct: 100,
    progressMessage: `Analysis complete - ${resultRows.length} result${resultRows.length === 1 ? '' : 's'}.`,
    completedAt: new Date(),
  });
}
