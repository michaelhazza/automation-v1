/**
 * memoryCitationDetectorPure — pure Jaccard + tool-call arg matching
 *
 * Scoring engines for the S12 citation detector. No I/O, no DB.
 *
 * Two-path matcher per spec §4.4:
 *   1. Tool-call structured args — exact string match between an entry's
 *      key phrases and any tool-call argument value. Score 1.0 on match,
 *      else 0.0. Structured args carry no paraphrasing noise; a match is a
 *      near-certain citation.
 *
 *   2. Generated text (fuzzy) — Jaccard over n-gram sets (n=3). The score
 *      is the overlap ratio, but only treated as a citation when BOTH the
 *      ratio ≥ CITATION_TEXT_OVERLAP_MIN and the absolute token overlap
 *      count ≥ CITATION_TEXT_TOKEN_MIN. Text is paraphrased; the dual-floor
 *      guards against false positives on short snippets.
 *
 * Final citation score = max(toolCallScore, textScore).
 *
 * Spec: docs/memory-and-briefings-spec.md §4.4 (S12)
 */

// ---------------------------------------------------------------------------
// Tokenization (pure)
// ---------------------------------------------------------------------------

/**
 * Normalise a string for n-gram tokenization: lowercase, strip non-word
 * punctuation, collapse whitespace. Deterministic and unicode-friendly for
 * ASCII. The citation detector tolerates paraphrase, so aggressive normalisation
 * is fine.
 */
export function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Word-level tokenization. Returns an empty array for empty / whitespace-only
 * inputs.
 */
export function tokenize(text: string): string[] {
  const normalised = normaliseText(text);
  if (!normalised) return [];
  return normalised.split(' ').filter((t) => t.length > 0);
}

/**
 * Build the n-gram set for `text`. Default n=3.
 *
 * Returns a Set of space-joined n-grams. When the token count is less than
 * `n`, returns a set containing the single joined token stream (partial gram)
 * so very short texts still have a comparable signature.
 */
export function ngramSet(text: string, n = 3): Set<string> {
  const tokens = tokenize(text);
  if (tokens.length === 0) return new Set();
  if (tokens.length < n) return new Set([tokens.join(' ')]);
  const set = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) {
    set.add(tokens.slice(i, i + n).join(' '));
  }
  return set;
}

/**
 * |A ∩ B|
 */
export function intersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const v of a) if (b.has(v)) count += 1;
  return count;
}

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|. Returns 0 when both sets are empty.
 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const inter = intersectionSize(a, b);
  const union = a.size + b.size - inter;
  if (union === 0) return 0;
  return inter / union;
}

// ---------------------------------------------------------------------------
// Tool-call arg matching
// ---------------------------------------------------------------------------

/**
 * Walk a tool-call argument tree, producing a Set of string argument values.
 * Non-string values (numbers, booleans) are coerced to string. Nested
 * arrays/objects are recursed into. Returns an empty set for null/undefined.
 */
export function extractArgStrings(
  args: unknown,
  out: Set<string> = new Set(),
): Set<string> {
  if (args === null || args === undefined) return out;
  if (typeof args === 'string') {
    if (args.trim().length > 0) out.add(args.trim());
    return out;
  }
  if (typeof args === 'number' || typeof args === 'boolean') {
    out.add(String(args));
    return out;
  }
  if (Array.isArray(args)) {
    for (const item of args) extractArgStrings(item, out);
    return out;
  }
  if (typeof args === 'object') {
    for (const v of Object.values(args as Record<string, unknown>)) {
      extractArgStrings(v, out);
    }
    return out;
  }
  return out;
}

/**
 * Tool-call score: 1.0 if any entry key phrase appears (substring, case
 * insensitive after normalisation) in any tool-call argument string, else 0.0.
 */
export function computeToolCallScore(
  entryKeyPhrases: string[],
  toolCallArgs: unknown[],
): number {
  if (entryKeyPhrases.length === 0 || toolCallArgs.length === 0) return 0;

  const argStrings: string[] = [];
  const argSet = new Set<string>();
  for (const args of toolCallArgs) extractArgStrings(args, argSet);
  for (const s of argSet) argStrings.push(normaliseText(s));

  for (const phrase of entryKeyPhrases) {
    const needle = normaliseText(phrase);
    if (!needle) continue;
    if (argStrings.some((hay) => hay.includes(needle))) return 1.0;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Text match
// ---------------------------------------------------------------------------

export interface TextMatchParams {
  entryContent: string;
  generatedText: string;
  /** Jaccard ratio floor. Default CITATION_TEXT_OVERLAP_MIN (0.35). */
  overlapMin: number;
  /** Absolute overlapping-token floor. Default CITATION_TEXT_TOKEN_MIN (8). */
  tokenMin: number;
  /** N-gram size. Default 3. */
  n?: number;
}

export interface TextMatchResult {
  /** Raw Jaccard score ∈ [0, 1]. */
  ratio: number;
  /** |entryNgrams ∩ generatedNgrams|. */
  overlap: number;
  /** Entry n-gram set size. */
  entrySize: number;
  /** Generated-text n-gram set size. */
  generatedSize: number;
  /** True when ratio ≥ overlapMin AND overlap ≥ tokenMin. */
  cited: boolean;
}

/**
 * Compute the fuzzy-text citation score. Returns the raw Jaccard ratio AND
 * a `cited` boolean that reflects both floors. Callers use `cited` for the
 * citation decision and `ratio` for the final score aggregation.
 */
export function computeTextMatch(params: TextMatchParams): TextMatchResult {
  const n = params.n ?? 3;
  const entryNgrams = ngramSet(params.entryContent, n);
  const generatedNgrams = ngramSet(params.generatedText, n);

  const overlap = intersectionSize(entryNgrams, generatedNgrams);
  const union = entryNgrams.size + generatedNgrams.size - overlap;
  const ratio = union === 0 ? 0 : overlap / union;

  const cited = ratio >= params.overlapMin && overlap >= params.tokenMin;

  return {
    ratio,
    overlap,
    entrySize: entryNgrams.size,
    generatedSize: generatedNgrams.size,
    cited,
  };
}

// ---------------------------------------------------------------------------
// Final score aggregation
// ---------------------------------------------------------------------------

export interface FinalCitationParams {
  toolCallScore: number;
  textMatch: TextMatchResult;
  /** CITATION_THRESHOLD from limits.ts. */
  threshold: number;
}

export interface FinalCitationResult {
  toolCallScore: number;
  textScore: number;
  finalScore: number;
  cited: boolean;
}

/**
 * Combine tool-call + text-match signals into the per-entry citation record
 * written to `memory_citation_scores`.
 *
 * Final score = max(toolCallScore, textScore) where textScore is the raw
 * Jaccard ratio. `cited` fires when:
 *   - toolCallScore ≥ threshold, OR
 *   - textMatch.cited (passes both Jaccard floor and absolute token floor).
 *
 * The dual-path `cited` rule means text matches must clear the strict
 * dual-floor even though the final_score field uses the raw ratio. This
 * keeps final_score useful for S4 ranking while preventing short-snippet
 * false-positives from counting as citations.
 */
export function computeFinalCitation(params: FinalCitationParams): FinalCitationResult {
  const textScore = params.textMatch.ratio;
  const finalScore = Math.max(params.toolCallScore, textScore);

  const cited =
    params.toolCallScore >= params.threshold || params.textMatch.cited;

  return {
    toolCallScore: params.toolCallScore,
    textScore,
    finalScore,
    cited,
  };
}
