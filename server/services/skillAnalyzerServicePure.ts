import { diffWordsWithSpace } from 'diff';
import { ParsedSkill, contentHash } from './skillParserServicePure.js';

// ---------------------------------------------------------------------------
// Skill Analyzer Service — Pure Functions
// Zero DB/env/service imports. Fully testable in isolation.
// ---------------------------------------------------------------------------

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

function isValidClassification(v: unknown): v is ClassificationResult['classification'] {
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

/** Derive a human-readable reason for a classification API failure.
 *  Pass the caught error, or null if the parse step returned null
 *  (meaning the API call succeeded but the response was unparseable). */
export function deriveClassificationFailureReason(
  err: unknown,
): 'rate_limit' | 'parse_error' | 'unknown' {
  if (err === null || err === undefined) return 'parse_error';
  const e = err as { statusCode?: number; code?: string };
  if (e?.statusCode === 429) return 'rate_limit';
  return 'unknown';
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

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const CLASSIFICATION_SYSTEM_PROMPT = `You are a skill deduplication expert. Your task is to compare two skill definitions and classify their relationship.

## Definitions

**DUPLICATE** — The incoming skill contains no new information whatsoever: no additional context, no broader coverage, no improved guidance, no extra examples — zero additive value. The skills are equivalent in all meaningful respects. If the incoming adds *anything* of value — even a paragraph of richer context — choose IMPROVEMENT instead. Recommended action: skip the incoming skill.

**IMPROVEMENT** — The incoming skill does everything the existing one does, but better. It may have a cleaner definition, better instructions, or improved structure. The existing skill should be replaced. Recommended action: replace existing with incoming.

**PARTIAL_OVERLAP** — The skills share a common purpose but differ in scope, approach, or specialization. Both have value. Neither fully replaces the other. Recommended action: human decision required (merge, keep both, or pick one).

**DISTINCT** — The skills have different purposes. One does not subsume or duplicate the other. They can coexist without confusion. Recommended action: import the incoming skill as new.

## Classification Rules

0. Do not rely solely on embedding similarity. Evaluate actual content differences carefully.
1. Focus on **functional capability**, not surface-level wording.
2. A skill that covers a strict subset of another is PARTIAL_OVERLAP, not DUPLICATE.
3. A skill with a better-structured definition but identical purpose is IMPROVEMENT.
4. If uncertain between DUPLICATE and IMPROVEMENT, prefer IMPROVEMENT (conservative).
5. If uncertain between PARTIAL_OVERLAP and DISTINCT, prefer PARTIAL_OVERLAP (conservative).

## Few-Shot Examples

### Example 1: DUPLICATE
**Existing:** "send_email — Sends an email via SMTP to a specified recipient with subject and body."
**Incoming:** "email_sender — Composes and delivers an email message to one or more recipients using the configured mail server."
**Classification:** DUPLICATE (same capability, different words)
**Confidence:** 0.95

### Example 2: IMPROVEMENT
**Existing:** "search_web — Searches the web and returns results."
**Incoming:** "search_web — Searches the web using multiple providers, handles rate limits gracefully, deduplicates results, and returns structured summaries with source citations."
**Classification:** IMPROVEMENT (same purpose, meaningfully better implementation)
**Confidence:** 0.88

### Example 3: PARTIAL_OVERLAP
**Existing:** "analyze_document — Reads and summarizes any document type."
**Incoming:** "analyze_legal_document — Extracts clauses, identifies risks, and summarizes legal contracts specifically."
**Classification:** PARTIAL_OVERLAP (legal docs is a subset; general doc analysis still has value)
**Confidence:** 0.82

### Example 4: DISTINCT
**Existing:** "generate_report — Creates formatted reports from data."
**Incoming:** "monitor_api_health — Checks API endpoints for availability and latency."
**Classification:** DISTINCT (different purposes entirely)
**Confidence:** 0.97

## Output Format

Respond with ONLY a JSON object in this exact format:
{
  "classification": "DUPLICATE" | "IMPROVEMENT" | "PARTIAL_OVERLAP" | "DISTINCT",
  "confidence": 0.0-1.0,
  "reasoning": "1-3 sentences explaining the classification decision"
}`;

/** Build the LLM classification prompt for a candidate/library pair.
 *  System prompt is identical across calls (cached by Anthropic).
 *  Only the user message changes per pair. */
export function buildClassificationPrompt(
  candidate: ParsedSkill,
  librarySkill: LibrarySkillSummary,
  band: 'likely_duplicate' | 'ambiguous'
): { system: string; userMessage: string } {
  const candidateSummary = formatSkillForPrompt('INCOMING SKILL (CANDIDATE)', {
    name: candidate.name,
    slug: candidate.slug,
    description: candidate.description,
    definition: candidate.definition,
    instructions: candidate.instructions,
  });

  const librarySummary = formatSkillForPrompt('EXISTING SKILL (LIBRARY)', {
    name: librarySkill.name,
    slug: librarySkill.slug,
    description: librarySkill.description,
    definition: librarySkill.definition,
    instructions: librarySkill.instructions,
  });

  const bandHint =
    band === 'likely_duplicate'
      ? 'Note: These skills have very high embedding similarity (>0.92). Prefer IMPROVEMENT unless the incoming is genuinely word-for-word equivalent with zero additive value.'
      : 'Note: These skills have moderate embedding similarity (0.60–0.92). Careful analysis needed.';

  const userMessage = `${candidateSummary}\n\n${librarySummary}\n\n${bandHint}\n\nClassify their relationship.`;

  return { system: CLASSIFICATION_SYSTEM_PROMPT, userMessage };
}

function formatSkillForPrompt(
  label: string,
  skill: {
    name: string;
    slug: string;
    description: string;
    definition: object | null;
    instructions: string | null;
  }
): string {
  const parts = [`## ${label}`, `**Name:** ${skill.name}`, `**Slug:** ${skill.slug}`];

  if (skill.description) parts.push(`**Description:** ${skill.description}`);

  if (skill.definition) {
    parts.push('**Tool Definition:**');
    parts.push('```json');
    parts.push(JSON.stringify(skill.definition, null, 2));
    parts.push('```');
  }

  if (skill.instructions) {
    parts.push('**Instructions:**');
    parts.push(skill.instructions.slice(0, 2500)); // truncate for token efficiency
  }

  return parts.join('\n');
}

/** Parse LLM classification response. Validates with Zod.
 *  Returns null if response is unparseable. */
export function parseClassificationResponse(response: string): ClassificationResult | null {
  // Extract JSON from response (may be wrapped in markdown code block)
  let jsonStr = response.trim();

  const jsonBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1].trim();
  } else {
    // Find first { ... } block
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start !== -1 && end > start) {
      jsonStr = jsonStr.slice(start, end + 1);
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!isValidClassification(parsed.classification)) return null;
    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) return null;
    if (typeof parsed.reasoning !== 'string') return null;
    return {
      classification: parsed.classification,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Phase 3: Classify prompt + parser with proposedMerge
// ---------------------------------------------------------------------------
// The base classify prompt + parser above are unchanged. Phase 3 of
// skill-analyzer-v2 introduces a parallel buildClassifyPromptWithMerge /
// parseClassificationResponseWithMerge pair that asks the LLM to ALSO
// produce a "best of both" merged version when classification is
// PARTIAL_OVERLAP or IMPROVEMENT. The merged version is what the Review UI
// renders in the Recommended column of the three-column merge view (Phase 5)
// and what executeApproved writes back on a partial-overlap update.
//
// Spec §6.1, §10 Phase 3, §9 edge case "LLM returns proposedMerge with
// fewer fields than expected".

/** Shape of the proposedMerge object the LLM is asked to return when
 *  classification is PARTIAL_OVERLAP or IMPROVEMENT. Matches the
 *  proposed_merged_content jsonb column on skill_analyzer_results. */
export interface ProposedMerge {
  name: string;
  description: string;
  // Anthropic tool definition object — never a string.
  definition: object;
  instructions: string | null;
}

/** Result returned by parseClassificationResponseWithMerge. The classification
 *  + confidence + reasoning fields match the base classifier; proposedMerge
 *  is non-null only when the LLM returned a valid merged version on a
 *  PARTIAL_OVERLAP / IMPROVEMENT classification. */
export interface ClassificationResultWithMerge {
  classification: 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';
  confidence: number;
  reasoning: string;
  proposedMerge: ProposedMerge | null;
}

const CLASSIFICATION_WITH_MERGE_SYSTEM_PROMPT = `${CLASSIFICATION_SYSTEM_PROMPT}

## Additional task: produce a merged version (PARTIAL_OVERLAP / IMPROVEMENT only)

When classification is PARTIAL_OVERLAP or IMPROVEMENT, ALSO produce a
\`proposedMerge\` object that takes the best of both — preserve what works in
the existing library version, incorporate genuine improvements from the
incoming version. Do NOT hallucinate novel content. Each field of the
proposed merge MUST be grounded in either the existing library text or the
incoming candidate text.

For DUPLICATE and DISTINCT classifications, OMIT the \`proposedMerge\` field
entirely (or set it to null) — there is nothing to merge.

The proposedMerge object has exactly four fields:
- \`name\` — string
- \`description\` — string
- \`definition\` — the Anthropic tool definition JSON object (\`name\`,
  \`description\`, \`input_schema\`). NEVER a string.
- \`instructions\` — string OR null

## Output Format (PARTIAL_OVERLAP or IMPROVEMENT)

Respond with ONLY a JSON object in this exact format:
{
  "classification": "PARTIAL_OVERLAP" | "IMPROVEMENT",
  "confidence": 0.0-1.0,
  "reasoning": "1-3 sentences explaining the classification decision",
  "proposedMerge": {
    "name": "...",
    "description": "...",
    "definition": { "name": "...", "description": "...", "input_schema": { ... } },
    "instructions": "..."
  }
}

## Output Format (DUPLICATE or DISTINCT)

Respond with ONLY a JSON object in this exact format (no proposedMerge):
{
  "classification": "DUPLICATE" | "DISTINCT",
  "confidence": 0.0-1.0,
  "reasoning": "1-3 sentences explaining the classification decision"
}`;

/** Build the merge-aware classification prompt for a candidate/library pair.
 *  Same shape as buildClassificationPrompt — system prompt is identical
 *  across calls (cached by Anthropic), only the user message changes per
 *  pair. */
export function buildClassifyPromptWithMerge(
  candidate: ParsedSkill,
  librarySkill: LibrarySkillSummary,
  band: 'likely_duplicate' | 'ambiguous',
): { system: string; userMessage: string } {
  const candidateSummary = formatSkillForPrompt('INCOMING SKILL (CANDIDATE)', {
    name: candidate.name,
    slug: candidate.slug,
    description: candidate.description,
    definition: candidate.definition,
    instructions: candidate.instructions,
  });

  const librarySummary = formatSkillForPrompt('EXISTING SKILL (LIBRARY)', {
    name: librarySkill.name,
    slug: librarySkill.slug,
    description: librarySkill.description,
    definition: librarySkill.definition,
    instructions: librarySkill.instructions,
  });

  const bandHint =
    band === 'likely_duplicate'
      ? 'Note: These skills have very high embedding similarity (>0.92). Prefer IMPROVEMENT unless the incoming is genuinely word-for-word equivalent with zero additive value.'
      : 'Note: These skills have moderate embedding similarity (0.60–0.92). Careful analysis needed.';

  const userMessage = `${candidateSummary}\n\n${librarySummary}\n\n${bandHint}\n\nClassify their relationship and (if PARTIAL_OVERLAP or IMPROVEMENT) produce a merged version.`;

  return { system: CLASSIFICATION_WITH_MERGE_SYSTEM_PROMPT, userMessage };
}

/** Validate that an unknown value matches the ProposedMerge shape. Pure —
 *  no library-row dependency. Per spec §9 edge case: a malformed merge is
 *  treated as missing (returns null), the row falls through to the existing
 *  null-fallback path, and execute rejects with "merge proposal unavailable
 *  — re-run analysis". The parser does NOT attempt field-level repair. */
function isValidProposedMerge(value: unknown): value is ProposedMerge {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== 'string' || v.name.length === 0) return false;
  if (typeof v.description !== 'string') return false;
  if (v.definition === null || typeof v.definition !== 'object') return false;
  // instructions may be null or string
  if (v.instructions !== null && typeof v.instructions !== 'string') return false;
  return true;
}

/** Parse the merge-aware LLM classification response. Returns null on
 *  unparseable output. When classification is PARTIAL_OVERLAP or IMPROVEMENT
 *  the parser tries to validate proposedMerge — if missing or malformed,
 *  proposedMerge is set to null and the row follows the §6.3 LLM-fallback
 *  path on execute. For DUPLICATE / DISTINCT, proposedMerge is always null
 *  regardless of what the LLM returned. */
export function parseClassificationResponseWithMerge(
  response: string,
): ClassificationResultWithMerge | null {
  // Extract JSON from response (may be wrapped in markdown code block).
  let jsonStr = response.trim();
  const jsonBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1].trim();
  } else {
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start !== -1 && end > start) {
      jsonStr = jsonStr.slice(start, end + 1);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (!isValidClassification(p.classification)) return null;
  if (typeof p.confidence !== 'number' || p.confidence < 0 || p.confidence > 1) return null;
  if (typeof p.reasoning !== 'string') return null;

  const classification = p.classification;
  let proposedMerge: ProposedMerge | null = null;
  if (classification === 'PARTIAL_OVERLAP' || classification === 'IMPROVEMENT') {
    if (p.proposedMerge !== undefined && p.proposedMerge !== null) {
      if (isValidProposedMerge(p.proposedMerge)) {
        proposedMerge = p.proposedMerge;
      }
      // Otherwise leave as null — null-fallback path on execute.
    }
  }

  return {
    classification,
    confidence: p.confidence,
    reasoning: p.reasoning,
    proposedMerge,
  };
}

// ---------------------------------------------------------------------------
// Diff Summary
// ---------------------------------------------------------------------------

/** Generate a structural diff summary between candidate and library skill.
 *  Used for the side-by-side UI display. */
export function generateDiffSummary(
  candidate: ParsedSkill,
  librarySkill: LibrarySkillSummary
): { addedFields: string[]; removedFields: string[]; changedFields: string[] } {
  const addedFields: string[] = [];
  const removedFields: string[] = [];
  const changedFields: string[] = [];

  const fields: Array<[string, unknown, unknown]> = [
    ['name', candidate.name, librarySkill.name],
    ['description', candidate.description, librarySkill.description],
    ['definition', candidate.definition, librarySkill.definition],
    ['instructions', candidate.instructions, librarySkill.instructions],
  ];

  for (const [field, candidateVal, libraryVal] of fields) {
    const hasCandidate = candidateVal !== null && candidateVal !== undefined && candidateVal !== '';
    const hasLibrary = libraryVal !== null && libraryVal !== undefined && libraryVal !== '';

    if (hasCandidate && !hasLibrary) {
      addedFields.push(field);
    } else if (!hasCandidate && hasLibrary) {
      removedFields.push(field);
    } else if (hasCandidate && hasLibrary) {
      const candidateStr = typeof candidateVal === 'object'
        ? JSON.stringify(candidateVal)
        : String(candidateVal);
      const libraryStr = typeof libraryVal === 'object'
        ? JSON.stringify(libraryVal)
        : String(libraryVal);
      if (candidateStr !== libraryStr) {
        changedFields.push(field);
      }
    }
  }

  return { addedFields, removedFields, changedFields };
}

// ---------------------------------------------------------------------------
// Agent ranking — Phase 2 of skill-analyzer-v2
// ---------------------------------------------------------------------------

/** Top-K constant for the agent-propose pipeline stage. The pipeline always
 *  persists at most this many proposals per DISTINCT result, regardless of
 *  threshold. The threshold below decides only which chips are pre-checked
 *  in the Review UI. See spec §6.2 and the iteration-1 HITL resolution
 *  on Finding 1.4. */
export const AGENT_PROPOSAL_TOPK = 3;

/** Similarity threshold for pre-selection. Proposals with score >= threshold
 *  ship with selected: true (pre-checked chip). Proposals below threshold
 *  ship with selected: false (visible but not pre-checked, so reviewers can
 *  promote them with one click if the AI under-scored an obvious fit). */
export const AGENT_PROPOSAL_THRESHOLD = 0.5;

/** One agent in the input set for ranking. The score is computed externally
 *  via cosineSimilarity; the helper just sorts and slices. */
export interface RankableAgent {
  systemAgentId: string;
  slug: string;
  name: string;
  embedding: number[];
}

/** One proposal entry in the output. Matches the agent_proposals jsonb
 *  shape on skill_analyzer_results (spec §5.2). */
export interface AgentProposal {
  systemAgentId: string;
  slugSnapshot: string;
  nameSnapshot: string;
  score: number;
  selected: boolean;
}

/** Rank a set of system agents by cosine similarity against a candidate
 *  embedding, take the top-K (regardless of threshold), and pre-select any
 *  result whose score is at or above the threshold. Pure — no DB, no clock.
 *
 *  Edge cases (covered by tests):
 *  - Empty agents list → empty proposals array
 *  - K > agents.length → returns all agents (truncation is min(K, count))
 *  - Tie scores → stable order (the underlying Array.sort is not guaranteed
 *    stable in older JS engines, but the V8 sort used by Node has been
 *    stable since v12, which the project requires)
 *  - All scores below threshold → still returns top-K, all with
 *    selected: false (reviewer can promote with one click)
 */
export function rankAgentsForCandidate(
  candidateEmbedding: number[],
  agents: readonly RankableAgent[],
  options: { topK?: number; threshold?: number } = {},
): AgentProposal[] {
  const topK = options.topK ?? AGENT_PROPOSAL_TOPK;
  const threshold = options.threshold ?? AGENT_PROPOSAL_THRESHOLD;

  if (agents.length === 0) return [];

  const scored = agents.map((a) => ({
    agent: a,
    score: cosineSimilarity(candidateEmbedding, a.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(topK, scored.length));

  return top.map(({ agent, score }) => ({
    systemAgentId: agent.systemAgentId,
    slugSnapshot: agent.slug,
    nameSnapshot: agent.name,
    score,
    selected: score >= threshold,
  }));
}

// ---------------------------------------------------------------------------
// Phase 5: deriveDiffRows — token-level diff for the Recommended column
// ---------------------------------------------------------------------------
// Used by the Phase 5 MergeReviewBlock React component to render inline
// highlighting in the Recommended column of the three-column merge view.
// Pure wrapper around jsdiff's diffWordsWithSpace so the diff algorithm
// is testable in isolation and the React component is a thin renderer.

/** One token in a token-level diff between two strings. The kind tells the
 *  renderer which span style to apply: 'unchanged' is plain text, 'added'
 *  is highlighted as an insertion, 'removed' is shown as a strikethrough. */
export interface DiffToken {
  kind: 'unchanged' | 'added' | 'removed';
  value: string;
}

/** Compute a word-level diff between current and recommended strings.
 *  Returns an array of tokens the React component can render as styled
 *  spans. Idempotent: passing the same strings twice yields equivalent
 *  arrays (modulo array identity). Pure — no DOM, no clock, no I/O.
 *
 *  Uses jsdiff's diffWordsWithSpace which keeps whitespace intact so
 *  rendering preserves the original layout. For the Phase 5 use case the
 *  Recommended column is highlighted against Current — so 'added' tokens
 *  are content NEW in Recommended that wasn't in Current, and 'removed'
 *  tokens are content present in Current that's missing from Recommended. */
export function deriveDiffRows(current: string, recommended: string): DiffToken[] {
  if (current === recommended) {
    return current.length === 0 ? [] : [{ kind: 'unchanged', value: current }];
  }
  const parts = diffWordsWithSpace(current, recommended);
  return parts.map((p) => ({
    kind: p.added ? 'added' : p.removed ? 'removed' : 'unchanged',
    value: p.value,
  }));
}

export const skillAnalyzerServicePure = {
  cosineSimilarity,
  classifyBand,
  computeBestMatches,
  buildClassificationPrompt,
  parseClassificationResponse,
  buildClassifyPromptWithMerge,
  parseClassificationResponseWithMerge,
  generateDiffSummary,
  rankAgentsForCandidate,
  deriveDiffRows,
  deriveClassificationFailureReason,
};
