/** Summary of a library skill (system or org) for comparison. */
export interface LibrarySkillSummary {
  id: string | null;           // null for system skills
  slug: string;
  name: string;
  description: string;
  definition: object | null;
  instructions: string | null;
  isSystem: boolean;
}

/** Result of LLM classification. */
export interface ClassificationResult {
  classification: 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';
  confidence: number;
  reasoning: string;
}

const VALID_CLASSIFICATIONS = ['DUPLICATE', 'IMPROVEMENT', 'PARTIAL_OVERLAP', 'DISTINCT'] as const;

export function isValidClassification(v: unknown): v is ClassificationResult['classification'] {
  return typeof v === 'string' && (VALID_CLASSIFICATIONS as readonly string[]).includes(v);
}

/** Three similarity bands for controlling LLM call volume. */
export type SimilarityBand = 'likely_duplicate' | 'ambiguous' | 'distinct';

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

/** Cosine similarity using dot product (valid for OpenAI embeddings which are
 *  pre-normalized to unit length). Returns 0.0–1.0. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  // Clamp to [0, 1] to handle floating point drift
  return Math.max(0, Math.min(1, dot));
}

/** Classify similarity score into a band.
 *  >0.92 → likely_duplicate (confirm via LLM, but probably skip import)
 *  0.60–0.92 → ambiguous (full LLM analysis needed)
 *  <0.60 → distinct (skip LLM, classify as DISTINCT directly) */
export function classifyBand(similarity: number): SimilarityBand {
  if (similarity > 0.92) return 'likely_duplicate';
  if (similarity >= 0.60) return 'ambiguous';
  return 'distinct';
}

/** Compute all pairwise similarities between candidates and library.
 *  For each candidate, returns only the single best-matching library skill.
 *  Results are sorted by candidate index. */
export function computeBestMatches(
  candidateEmbeddings: Array<{ index: number; embedding: number[] }>,
  libraryEmbeddings: Array<{ id: string | null; slug: string; name: string; embedding: number[] }>
): Array<{
  candidateIndex: number;
  libraryId: string | null;
  librarySlug: string | null;
  libraryName: string | null;
  similarity: number;
  band: SimilarityBand;
}> {
  return candidateEmbeddings.map((candidate) => {
    let bestSimilarity = 0;
    let bestLibrary: (typeof libraryEmbeddings)[0] | null = null;

    for (const lib of libraryEmbeddings) {
      const sim = cosineSimilarity(candidate.embedding, lib.embedding);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestLibrary = lib;
      }
    }

    return {
      candidateIndex: candidate.index,
      libraryId: bestLibrary?.id ?? null,
      librarySlug: bestLibrary?.slug ?? null,
      libraryName: bestLibrary?.name ?? null,
      similarity: bestSimilarity,
      band: classifyBand(bestSimilarity),
    };
  });
}
