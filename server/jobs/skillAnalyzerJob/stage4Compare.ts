import { updateJobProgress } from '../../services/skillAnalyzerService.js';
import { skillAnalyzerServicePure } from '../../services/skillAnalyzerServicePure.js';
import { skillParserServicePure } from '../../services/skillParserServicePure.js';
import type { ParsedSkill } from '../../services/skillParserServicePure.js';
import { type JobContext, type BestMatch } from './types.js';

// -------------------------------------------------------------------------
// Stage 4: Compare (40% → 60%)
// -------------------------------------------------------------------------
export async function runStage4(ctx: JobContext, jobId: string): Promise<JobContext> {
  await updateJobProgress(jobId, {
    status: 'comparing',
    progressPct: 40,
    progressMessage: 'Computing similarity scores...',
  });

  const { remainingCandidates, librarySkills, embeddingByContent } = ctx;

  // Build embedding arrays for comparison
  const candidateEmbeddingsForCompare = remainingCandidates
    .map(({ index, hash }) => {
      const embedding = embeddingByContent.get(hash);
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
      const embedding = embeddingByContent.get(hash);
      return embedding ? { id: lib.id, slug: lib.slug, name: lib.name, embedding } : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

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

  return { ...ctx, bestMatches, candidateEmbeddingsForCompare };
}
