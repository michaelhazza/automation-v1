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
): 'rate_limit' | 'parse_error' | 'timed_out' | 'unknown' {
  if (err === null || err === undefined) return 'parse_error';
  const e = err as { statusCode?: number; code?: string };
  if (e.code === 'CLASSIFY_TIMEOUT') return 'timed_out';
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
  // Classification-only: 2500-char limit keeps input tokens low.
  // The full instructions aren't needed to judge similarity.
  const candidateSummary = formatSkillForPrompt('INCOMING SKILL (CANDIDATE)', {
    name: candidate.name,
    slug: candidate.slug,
    description: candidate.description,
    definition: candidate.definition,
    instructions: candidate.instructions,
  }, 2500);

  const librarySummary = formatSkillForPrompt('EXISTING SKILL (LIBRARY)', {
    name: librarySkill.name,
    slug: librarySkill.slug,
    description: librarySkill.description,
    definition: librarySkill.definition,
    instructions: librarySkill.instructions,
  }, 2500);

  const bandHint =
    band === 'likely_duplicate'
      ? 'Note: These skills have very high embedding similarity (>0.92). Prefer IMPROVEMENT unless the incoming is genuinely word-for-word equivalent with zero additive value.'
      : 'Note: These skills have moderate embedding similarity (0.60–0.92). At this level, DUPLICATE is rarely the right call — it requires zero additive value and near-identical content. If there is any meaningful difference in scope, framing, or approach, prefer PARTIAL_OVERLAP.';

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
  },
  maxInstructionsLength?: number,
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
    // No limit when omitted — the merge path needs the full content to
    // produce a complete proposedMerge. The classification-only path
    // passes 2500 to keep input token cost low.
    parts.push(
      maxInstructionsLength !== undefined
        ? skill.instructions.slice(0, maxInstructionsLength)
        : skill.instructions,
    );
  }

  return parts.join('\n');
}

/** Parse LLM classification response. Validates with Zod.
 *  Returns null if response is unparseable. */
export function parseClassificationResponse(response: string): ClassificationResult | null {
  // Use brace extraction, not code-block regex — same reasoning as
  // parseClassificationResponseWithMerge. Non-greedy regex breaks on
  // responses whose string values contain triple backticks.
  let jsonStr = response.trim();
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start !== -1 && end > start) {
    jsonStr = jsonStr.slice(start, end + 1);
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
\`proposedMerge\` object using this strategy:

Focus specifically on the \`instructions\` field — this is where the depth
difference matters most.

### Hard constraints (never violate)

- **No content loss.** Every piece of unique information from the richer skill
  must appear in the merged output. The only permitted reason for the merged
  output to be shorter than the richer input is deduplication of genuinely
  identical content.
- **No hallucination.** Every sentence must be grounded in either the existing
  library text or the incoming candidate text.
- **Scope discipline.** Only include content that directly serves the core
  purpose of the merged skill. Exclude tool integrations, CLI workflows, or
  references to external systems unless they are essential for the skill to
  function. A skill about ad copy generation should not inherit a video
  production section just because the incoming skill happened to include one.

### Soft constraints (follow unless they conflict with hard constraints)

- **You may lightly restructure or rewrite sections for clarity and flow** as
  long as no meaning or unique information is lost. Preserving clarity is more
  important than preserving exact sentence structure.
- **You may reorder sections** so the merged instructions follow a logical
  progression (context-gathering → how the skill works → execution → output).
- **Voice** — normalise inserted content to match the base skill's register
  (imperative, second-person, etc.). Do not leave jarring style shifts at join
  points.
- **Terminology** — normalise to the base skill's vocabulary where both skills
  use different words for the same concept.

### Assembly steps

1. **Identify the richer instructions base.** Assess both skills' instructions
   against these criteria: more named sections or frameworks; covers more
   distinct use cases or edge cases; contains concrete examples, batch
   workflows, or "common mistakes" content. The skill scoring higher becomes
   the BASE. When the INCOMING SKILL is substantially more comprehensive, it is
   the base — not the existing library skill.
2. **Start from the base.** The base instructions form the foundation of
   \`proposedMerge.instructions\`.
3. **Layer in unique elements from the non-base skill.** Scan for named
   sections, rules, or examples genuinely absent from the base. Insert at the
   logical position. Apply the scope discipline hard constraint — do not import
   sections that are outside the merged skill's core purpose.
4. **Deduplicate.** Where both skills cover the same topic, keep only the
   stronger version. Do not include both. To decide which version wins, prefer
   in this order: (a) more structured — has clear headings, numbered steps, or
   tables; (b) includes concrete examples; (c) covers constraints or edge cases.
5. **Resolve contradictions.** Conflicting guidance on the same point: prefer
   the more specific or more detailed instruction.
6. **Edit for coherence.** Apply the soft constraints — rewrite for flow,
   normalise voice and terminology, remove seams. The output must read as a
   single authored document.

### Output completeness

The \`instructions\` field may be several thousand characters long. Output it
in full — do NOT truncate, summarise, or trail off with "..." under any
circumstances. The entire merged instructions must appear in the JSON response.

### Final self-check (required before returning)

Before writing the JSON response, verify:
- No section appears more than once (e.g. two platform specs tables)
- No broken or half-merged sentences at any join point
- No conflicting instructions remain (e.g. two different rules for the same scenario)
- Section order follows a logical flow: context-gathering → how the skill works → execution → output format
- Instructions read cleanly from start to finish as a single authored document
- \`definition.input_schema\` is valid JSON with no duplicate keys
- The response is complete — no trailing "..." or cut-off content
If any issue is found, fix it before returning.

For DUPLICATE and DISTINCT classifications, OMIT the \`proposedMerge\` field
entirely (or set it to null) — there is nothing to merge.

The proposedMerge object has exactly four fields:
- \`name\` — string. Prefer the incoming skill's name/slug if it is more
  descriptive or better reflects the merged scope; otherwise keep the existing.
- \`description\` — string. Prefer a trigger-style description (explaining WHEN
  to invoke this skill) over a one-liner summary if one skill has it and the
  other does not — trigger descriptions are more useful for agent routing.
- \`definition\` — the Anthropic tool definition JSON object (\`name\`,
  \`description\`, \`input_schema\`). NEVER a string. Merge rules:
    • \`name\` — match the chosen \`name\` field above (snake_case slug).
    • \`description\` — use the richer/more complete description.
    • \`input_schema.required\` — keep all fields that are required in the
      base. Never introduce new required fields from the non-base unless they
      are required for ALL valid uses of the merged skill. When uncertain,
      default to optional — it is always the safer choice.
    • \`input_schema.properties\` — union both sets. For parameters that exist
      in both, use the more detailed \`description\`. For enum fields, union
      the enum values from both skills (e.g. if one supports google/meta and
      the other adds tiktok/twitter, the merged enum includes all four).
      New optional parameters from the non-base are added as optional fields.
    • Preserve all file path references, tool names, and markdown links
      exactly as they appear in the source skill — do not alter or invent them.
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
      : 'Note: These skills have moderate embedding similarity (0.60–0.92). At this level, DUPLICATE is rarely the right call — it requires zero additive value and near-identical content. If there is any meaningful difference in scope, framing, or approach, prefer PARTIAL_OVERLAP.';

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
  // Extract JSON from response using brace matching, not code-block regex.
  // The code-block regex approach (non-greedy [\s\S]*?) breaks when
  // proposedMerge.instructions contains triple backticks (markdown code
  // examples), causing the regex to stop at the first ``` inside the
  // string and extract truncated JSON. Brace extraction is robust to
  // wrapping, preamble/postamble, and any content inside string values.
  let jsonStr = response.trim();
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start !== -1 && end > start) {
    jsonStr = jsonStr.slice(start, end + 1);
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
  // Normalise confidence: Sonnet occasionally returns a percentage integer (e.g. 85)
  // instead of a decimal (0.85). Clamp to [0, 1] — values > 1 are treated as
  // percentages and divided by 100.
  if (typeof p.confidence !== 'number') return null;
  const raw = p.confidence;
  const confidence = raw > 1 ? raw / 100 : raw;
  if (confidence < 0 || confidence > 1) return null;
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
    confidence,
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
 *  shape on skill_analyzer_results (spec §5.2).
 *  Stage 7b enriches proposals with optional llmReasoning / llmConfirmed
 *  fields written into the same JSONB without a schema migration. */
export interface AgentProposal {
  systemAgentId: string;
  slugSnapshot: string;
  nameSnapshot: string;
  score: number;
  selected: boolean;
  /** Haiku-generated reasoning for why this agent was suggested. Present only
   *  on the top proposal after Stage 7b runs. */
  llmReasoning?: string;
  /** True if the Haiku routing call confirmed this agent as the best fit. */
  llmConfirmed?: boolean;
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

// ---------------------------------------------------------------------------
// Non-skill file detection — heuristic, no LLM
// ---------------------------------------------------------------------------
// Detects two categories of files that may slip through skill imports but
// are not executable skills:
//
//   isDocumentationFile — README-style files: no tool definition, no
//     description, and a large blob of raw content (e.g. the marketingskills
//     repo README imported as a "skill" because it was a top-level file).
//
//   isContextFile — Foundation context documents: no tool definition but
//     a proper trigger description and rich instructions (e.g.
//     product-marketing-context). These ARE valid to import, but they should
//     go to Knowledge Management Agent and be flagged with a different badge
//     in the Review UI rather than being treated as regular executable skills.

export interface NonSkillFlags {
  isDocumentationFile: boolean;
  isContextFile: boolean;
}

/** Heuristically flag parsed skills that are not executable tools. Pure —
 *  no DB, no clock. Returns { false, false } for normal skills. */
export function detectNonSkillFile(skill: ParsedSkill): NonSkillFlags {
  // All executable skills have a tool definition (input_schema).
  // Files without one are either docs or context files.
  if (skill.definition !== null) {
    return { isDocumentationFile: false, isContextFile: false };
  }

  const hasDescription = typeof skill.description === 'string' && skill.description.trim().length > 20;
  const instructionLength = typeof skill.instructions === 'string' ? skill.instructions.length : 0;

  // Documentation file: no definition, no description, substantial content blob.
  // Classic pattern: a README or index file imported as a skill.
  if (!hasDescription && instructionLength > 200) {
    return { isDocumentationFile: true, isContextFile: false };
  }

  // Context file: no definition but a proper description AND meaningful
  // instructions exist. Pattern: foundation skill documents
  // (product-marketing-context etc.) that are meant to be read by other
  // skills before executing, not called as tools themselves.
  // Requiring instructions (> 100 chars) prevents false positives on
  // stub or index files that have only a description and no content.
  if (hasDescription && instructionLength > 100) {
    return { isDocumentationFile: false, isContextFile: true };
  }

  return { isDocumentationFile: false, isContextFile: false };
}

// ---------------------------------------------------------------------------
// LLM-assisted agent suggestion — Haiku (Stage 7b)
// ---------------------------------------------------------------------------
// After the cosine-similarity stage proposes agents, a cheap Haiku call
// reads the skill's actual purpose and the agent names to make a judgment
// call. This replaces the pure-embedding result for the top proposal and
// adds reasoning text that is surfaced in the Review UI.
//
// Model: claude-haiku-4-5-20251001
// Why Haiku: short input (~600 tokens), short output (~100 tokens), simple
// routing task — no complex reasoning needed.

const AGENT_SUGGESTION_SYSTEM_PROMPT = `You are a routing agent for a skill library. Your task is to identify which system agent is the best home for a new skill.

You will receive a skill's name, slug, description, and a brief summary of its purpose, plus a list of available system agents (name and slug).

Select the single best-fit agent. If no agent is a genuinely reasonable home for this skill, set noGoodMatch to true.

Rules:
- Choose based on the agent's functional domain, not keyword matching.
- An agent is a "good match" only if this skill naturally belongs in its area of responsibility.
- If the best candidate scores below ~50% confidence, set noGoodMatch to true.

Respond with ONLY a JSON object:
{
  "suggestedAgentSlug": "...",
  "noGoodMatch": false,
  "reasoning": "One sentence explaining why this agent is the best fit (or why none fit)."
}`;

export interface AgentSuggestionResult {
  suggestedAgentSlug: string | null;
  noGoodMatch: boolean;
  reasoning: string;
}

/** Build the Haiku agent-suggestion prompt for a single DISTINCT skill. */
export function buildAgentSuggestionPrompt(
  skill: { name: string; slug: string; description: string; instructions?: string | null },
  availableAgents: ReadonlyArray<{ slug: string; name: string }>,
): { system: string; userMessage: string } {
  const agentList = availableAgents
    .map((a) => `- ${a.name} (slug: ${a.slug})`)
    .join('\n');

  // Brief instructions preview (first 300 chars) keeps the Haiku call cheap
  // while giving enough context to make a routing decision.
  const instructionPreview =
    skill.instructions && skill.instructions.length > 0
      ? `\n**Instructions preview:** ${skill.instructions.slice(0, 300)}${skill.instructions.length > 300 ? '…' : ''}`
      : '';

  const userMessage =
    `## Skill to route\n` +
    `**Name:** ${skill.name}\n` +
    `**Slug:** ${skill.slug}\n` +
    `**Description:** ${skill.description || '(none)'}` +
    instructionPreview +
    `\n\n## Available agents\n${agentList}\n\nWhich agent should own this skill?`;

  return { system: AGENT_SUGGESTION_SYSTEM_PROMPT, userMessage };
}

/** Parse the Haiku agent-suggestion response. Returns null on invalid output. */
export function parseAgentSuggestionResponse(response: string): AgentSuggestionResult | null {
  let jsonStr = response.trim();
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start !== -1 && end > start) jsonStr = jsonStr.slice(start, end + 1);

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    if (typeof parsed.noGoodMatch !== 'boolean') return null;
    if (typeof parsed.reasoning !== 'string') return null;
    const slug = parsed.suggestedAgentSlug;
    if (slug !== null && typeof slug !== 'string') return null;
    return {
      suggestedAgentSlug: typeof slug === 'string' ? slug : null,
      noGoodMatch: parsed.noGoodMatch,
      reasoning: parsed.reasoning,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Agent cluster recommendation — Sonnet (Stage 8b)
// ---------------------------------------------------------------------------
// After all results are written, check whether multiple DISTINCT skills have
// no good agent home (best cosine score < AGENT_RECOMMENDATION_THRESHOLD).
// If enough weak-match skills cluster together thematically, Sonnet is asked
// whether a new agent should be created.
//
// Model: claude-sonnet-4-6 (needs cross-skill synthesis, not just routing)

/** Minimum score below which an agent proposal is considered a "weak match". */
export const AGENT_RECOMMENDATION_THRESHOLD = 0.55;

/** Minimum number of weak-match DISTINCT skills needed to trigger the
 *  cluster-recommendation Sonnet call. Below this, spread to existing agents. */
export const AGENT_RECOMMENDATION_MIN_SKILLS = 3;

export interface AgentRecommendation {
  shouldCreateAgent: boolean;
  agentName?: string;
  agentSlug?: string;
  agentDescription?: string;
  reasoning: string;
  skillSlugs?: string[];
}

const AGENT_CLUSTER_SYSTEM_PROMPT = `You are an AI agent architecture advisor for a business automation platform. Your task is to analyse a set of skills that don't fit well into any existing agent and determine whether a new agent should be created to house them.

A new agent IS justified when:
- 3 or more skills share a coherent, specialised purpose or domain
- That domain is not already covered by any of the listed existing agents
- The skills would work together as a cohesive capability set for a clear business function

A new agent is NOT justified when:
- The skills are diverse and don't cluster around a clear theme
- They could reasonably be distributed across existing agents with minor stretching
- There are fewer than 3 skills without a genuine home

When recommending an agent:
- Name it after its business function, not the skills (e.g. "Growth Marketing Agent", not "CRO Skills Agent")
- Write a description that explains when a user would invoke this agent and what it owns
- Only include skills in skillSlugs that genuinely belong on this agent

Respond with ONLY a JSON object:
{
  "shouldCreateAgent": true,
  "agentName": "...",
  "agentSlug": "...",
  "agentDescription": "...",
  "reasoning": "2-3 sentences explaining why these skills form a coherent new agent.",
  "skillSlugs": ["...", "..."]
}

Or if no new agent is needed:
{
  "shouldCreateAgent": false,
  "reasoning": "2-3 sentences explaining why existing agents can absorb these skills."
}`;

/** Build the Sonnet cluster-recommendation prompt. */
export function buildAgentClusterRecommendationPrompt(
  weakMatchSkills: ReadonlyArray<{ slug: string; name: string; description: string }>,
  existingAgents: ReadonlyArray<{ slug: string; name: string }>,
): { system: string; userMessage: string } {
  const skillList = weakMatchSkills
    .map((s) => `- **${s.name}** (slug: ${s.slug}): ${s.description || '(no description)'}`)
    .join('\n');

  const agentList = existingAgents
    .map((a) => `- ${a.name} (slug: ${a.slug})`)
    .join('\n');

  const userMessage =
    `## Skills with no strong agent home\n` +
    `These ${weakMatchSkills.length} skills all have a best agent-match score below 55%:\n\n` +
    skillList +
    `\n\n## Existing agents\n${agentList}\n\n` +
    `Should a new agent be created to house some or all of these skills?`;

  return { system: AGENT_CLUSTER_SYSTEM_PROMPT, userMessage };
}

/** Parse the Sonnet cluster-recommendation response. Returns null on invalid output. */
export function parseAgentClusterRecommendationResponse(response: string): AgentRecommendation | null {
  let jsonStr = response.trim();
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start !== -1 && end > start) jsonStr = jsonStr.slice(start, end + 1);

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    if (typeof parsed.shouldCreateAgent !== 'boolean') return null;
    if (typeof parsed.reasoning !== 'string') return null;

    if (!parsed.shouldCreateAgent) {
      return { shouldCreateAgent: false, reasoning: parsed.reasoning };
    }

    if (typeof parsed.agentName !== 'string') return null;
    if (typeof parsed.agentSlug !== 'string') return null;
    if (typeof parsed.agentDescription !== 'string') return null;
    const slugs = Array.isArray(parsed.skillSlugs)
      ? (parsed.skillSlugs as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];

    return {
      shouldCreateAgent: true,
      agentName: parsed.agentName,
      agentSlug: parsed.agentSlug,
      agentDescription: parsed.agentDescription,
      reasoning: parsed.reasoning,
      skillSlugs: slugs,
    };
  } catch {
    return null;
  }
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
  detectNonSkillFile,
  buildAgentSuggestionPrompt,
  parseAgentSuggestionResponse,
  buildAgentClusterRecommendationPrompt,
  parseAgentClusterRecommendationResponse,
  AGENT_RECOMMENDATION_THRESHOLD,
  AGENT_RECOMMENDATION_MIN_SKILLS,
};
