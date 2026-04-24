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
  mergeRationale?: string;   // optional — omitted before storage, surfaced in UI
}

export type MergeWarningCode =
  | 'REQUIRED_FIELD_DEMOTED'
  | 'CAPABILITY_OVERLAP'
  | 'SCOPE_EXPANSION'
  | 'SCOPE_EXPANSION_CRITICAL'
  | 'TABLE_ROWS_DROPPED'
  | 'INVOCATION_LOST'
  | 'HITL_LOST'
  | 'OUTPUT_FORMAT_LOST'
  | 'WARNINGS_TRUNCATED'
  // v2 fix-cycle additions
  | 'CLASSIFIER_FALLBACK'
  | 'NAME_MISMATCH'
  | 'SKILL_GRAPH_COLLISION'
  | 'SOURCE_FORK'
  | 'NEAR_REPLACEMENT'
  | 'CONTENT_OVERLAP';

export type MergeWarningSeverity = 'warning' | 'critical';

export interface MergeWarning {
  code: MergeWarningCode;
  severity: MergeWarningSeverity;
  message: string;
  detail?: string;
}

/** Warning tier — read from skill_analyzer_config.warning_tier_map.
 *  Controls how the Approve button gates on each warning. See plan §4. */
export type WarningTier =
  | 'informational'         // display only
  | 'standard'              // single-click acknowledgment
  | 'decision_required'     // structured resolution needed
  | 'critical';             // edit merge OR type confirmation phrase

/** Default tier map used when config snapshot is absent (e.g., legacy jobs).
 *  Mirrors the DB default in migration 0155. */
export const DEFAULT_WARNING_TIER_MAP: Record<MergeWarningCode, WarningTier> = {
  REQUIRED_FIELD_DEMOTED:   'decision_required',
  NAME_MISMATCH:            'decision_required',
  SKILL_GRAPH_COLLISION:    'decision_required',
  INVOCATION_LOST:          'decision_required',
  HITL_LOST:                'decision_required',
  CLASSIFIER_FALLBACK:      'decision_required',
  SCOPE_EXPANSION_CRITICAL: 'critical',
  SCOPE_EXPANSION:          'standard',
  CAPABILITY_OVERLAP:       'standard',
  TABLE_ROWS_DROPPED:       'informational',
  OUTPUT_FORMAT_LOST:       'informational',
  WARNINGS_TRUNCATED:       'informational',
  SOURCE_FORK:              'decision_required',
  NEAR_REPLACEMENT:         'standard',
  CONTENT_OVERLAP:          'standard',
};

/** Severity priority used when sorting warnings before MAX-count truncation.
 *  Higher number = higher priority; survives when warnings are capped. */
const WARNING_SEVERITY_PRIORITY: Record<MergeWarningSeverity, number> = {
  critical: 2,
  warning: 1,
};

/** Tier priority used as secondary sort. Higher = kept during truncation. */
const WARNING_TIER_PRIORITY: Record<WarningTier, number> = {
  critical: 4,
  decision_required: 3,
  standard: 2,
  informational: 1,
};

/** Sort warnings in-place by severity and tier priority so the highest-value
 *  ones survive MAX_MERGE_WARNINGS truncation. Exported for tests. */
export function sortWarningsBySeverity(
  warnings: MergeWarning[],
  tierMap: Record<string, WarningTier> = DEFAULT_WARNING_TIER_MAP,
): MergeWarning[] {
  return warnings.slice().sort((a, b) => {
    const sev = WARNING_SEVERITY_PRIORITY[b.severity] - WARNING_SEVERITY_PRIORITY[a.severity];
    if (sev !== 0) return sev;
    const aTier = tierMap[a.code] ?? DEFAULT_WARNING_TIER_MAP[a.code as MergeWarningCode] ?? 'informational';
    const bTier = tierMap[b.code] ?? DEFAULT_WARNING_TIER_MAP[b.code as MergeWarningCode] ?? 'informational';
    return WARNING_TIER_PRIORITY[bTier] - WARNING_TIER_PRIORITY[aTier];
  });
}

/** Reviewer resolution recorded against a warning. Append-only JSONB array
 *  on skill_analyzer_results.warning_resolutions, deduped by composite key
 *  (warningCode, details.field ?? null). Wiped on merge edit. */
export type WarningResolutionKind =
  | 'accept_removal'
  | 'restore_required'
  | 'use_library_name'
  | 'use_incoming_name'
  | 'scope_down'
  | 'flag_other'
  | 'accept_overlap'
  | 'acknowledge_low_confidence'
  | 'acknowledge_warning'
  | 'confirm_critical_phrase';

export interface WarningResolution {
  warningCode: MergeWarningCode;
  resolution: WarningResolutionKind;
  resolvedAt: string;    // ISO timestamp
  resolvedBy: string;    // userId
  details?: { field?: string; disambiguationNote?: string; collidingSkillId?: string };
}

export interface ApprovalBlockingReason {
  warningCode: MergeWarningCode;
  tier: WarningTier;
  message: string;
  field?: string;
}

export interface RequiredResolution {
  warningCode: MergeWarningCode;
  allowedResolutions: WarningResolutionKind[];
  field?: string;
}

export interface ApprovalState {
  blocked: boolean;
  reasons: ApprovalBlockingReason[];
  requiredResolutions: RequiredResolution[];
}

/** Concurrency guard used by resolveWarning. Pure so we can test it without
 *  spinning up a DB. Returns one of:
 *    - 'ok' when the client's token matches the row's canonical stamp within
 *      SKEW_MS tolerance.
 *    - 'stale' when the row's stamp has drifted outside tolerance (i.e.,
 *      another session wrote first, or the client fabricated a token).
 *    - 'missing' when neither mergeUpdatedAt nor createdAt exists — indicates
 *      a corrupt row and should 500 rather than 409. */
export type ConcurrencyCheckResult = 'ok' | 'stale' | 'missing';

export function checkConcurrencyStamp(
  rowMergeUpdatedAt: Date | string | null | undefined,
  rowCreatedAt: Date | string | null | undefined,
  clientStamp: Date | string,
  skewMs = 2_000,
): ConcurrencyCheckResult {
  const rowStampRaw = rowMergeUpdatedAt ?? rowCreatedAt;
  if (!rowStampRaw) return 'missing';
  const rowStamp = rowStampRaw instanceof Date ? rowStampRaw : new Date(rowStampRaw);
  const client = clientStamp instanceof Date ? clientStamp : new Date(clientStamp);
  if (Number.isNaN(rowStamp.getTime()) || Number.isNaN(client.getTime())) return 'stale';
  return Math.abs(rowStamp.getTime() - client.getTime()) > skewMs ? 'stale' : 'ok';
}

/** Allowed resolution kinds per warning code. */
const RESOLUTIONS_FOR_CODE: Record<MergeWarningCode, WarningResolutionKind[]> = {
  REQUIRED_FIELD_DEMOTED:   ['accept_removal', 'restore_required'],
  NAME_MISMATCH:            ['use_library_name', 'use_incoming_name'],
  SKILL_GRAPH_COLLISION:    ['scope_down', 'flag_other', 'accept_overlap'],
  INVOCATION_LOST:          ['acknowledge_warning'],
  HITL_LOST:                ['acknowledge_warning'],
  CLASSIFIER_FALLBACK:      ['acknowledge_low_confidence'],
  SCOPE_EXPANSION_CRITICAL: ['confirm_critical_phrase'],
  SCOPE_EXPANSION:          ['acknowledge_warning'],
  CAPABILITY_OVERLAP:       ['acknowledge_warning'],
  TABLE_ROWS_DROPPED:       [],
  OUTPUT_FORMAT_LOST:       [],
  WARNINGS_TRUNCATED:       [],
  SOURCE_FORK:              ['acknowledge_warning'],
  NEAR_REPLACEMENT:         ['acknowledge_warning'],
  CONTENT_OVERLAP:          ['acknowledge_warning'],
};

/** Parse demoted field list out of a REQUIRED_FIELD_DEMOTED warning's detail.
 *  Accepts both the legacy comma-delimited string and the structured JSON form. */
export function parseDemotedFields(detail: string | undefined): string[] {
  if (!detail) return [];
  const trimmed = detail.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed?.demotedFields)) return parsed.demotedFields.filter((f: unknown) => typeof f === 'string');
    } catch {
      // fall through to legacy split
    }
  }
  return trimmed.split(/\s*,\s*/).filter(Boolean);
}

/** Return true if a resolution satisfies a given warning/field pair. */
function isResolvedBy(
  code: MergeWarningCode,
  field: string | undefined,
  resolutions: WarningResolution[],
): boolean {
  const allowed = RESOLUTIONS_FOR_CODE[code] ?? [];
  return resolutions.some(r =>
    r.warningCode === code
    && (allowed.length === 0 || allowed.includes(r.resolution))
    && (field === undefined || r.details?.field === field));
}

/**
 * Canonical approval-gate evaluator. Server is authoritative; client imports
 * this for optimistic preview only. Covers all v2 fix-cycle tiers.
 *
 * - `informational`: never blocks.
 * - `standard`:      blocks unless an `acknowledge_warning` resolution exists.
 * - `decision_required`:
 *     - REQUIRED_FIELD_DEMOTED: per-field `accept_removal` or `restore_required`.
 *     - Otherwise: any allowed resolution for the code.
 * - `critical`: blocks unless `confirm_critical_phrase` resolution exists
 *     (or scope-expansion is already within threshold — the validator just
 *     won't re-emit the warning in that case).
 */
export function evaluateApprovalState(
  warnings: MergeWarning[] | null | undefined,
  resolutions: WarningResolution[] | null | undefined,
  tierMap: Record<string, WarningTier> = DEFAULT_WARNING_TIER_MAP,
): ApprovalState {
  const reasons: ApprovalBlockingReason[] = [];
  const required: RequiredResolution[] = [];
  const safeWarnings = warnings ?? [];
  const safeResolutions = resolutions ?? [];

  for (const w of safeWarnings) {
    const tier = (tierMap[w.code] ?? DEFAULT_WARNING_TIER_MAP[w.code]) ?? 'informational';
    if (tier === 'informational') continue;

    // Per-field decision gate for REQUIRED_FIELD_DEMOTED.
    if (w.code === 'REQUIRED_FIELD_DEMOTED') {
      const fields = parseDemotedFields(w.detail);
      for (const field of fields) {
        if (!isResolvedBy('REQUIRED_FIELD_DEMOTED', field, safeResolutions)) {
          reasons.push({
            warningCode: w.code,
            tier,
            message: `Field "${field}" — choose Accept removal or Restore required.`,
            field,
          });
          required.push({
            warningCode: w.code,
            allowedResolutions: RESOLUTIONS_FOR_CODE.REQUIRED_FIELD_DEMOTED,
            field,
          });
        }
      }
      continue;
    }

    // Generic gate: code must be resolved at least once.
    if (!isResolvedBy(w.code, undefined, safeResolutions)) {
      reasons.push({
        warningCode: w.code,
        tier,
        message: w.message,
      });
      required.push({
        warningCode: w.code,
        allowedResolutions: RESOLUTIONS_FOR_CODE[w.code] ?? ['acknowledge_warning'],
      });
    }
  }

  return {
    blocked: reasons.length > 0,
    reasons,
    requiredResolutions: required,
  };
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
  Additionally: the merged instructions must not substantially exceed the length
  of the richer source skill. If the merged output is more than 30% longer than
  the richer source, you have likely imported out-of-scope content. Revisit and
  trim.
- **Invocation trigger preservation.** If either source skill opens with a block
  that states when to invoke the skill — recognisable by phrases such as "Invoke
  this skill when", "Use this skill when", "Call this skill when", "Trigger this
  skill when", or any block whose primary purpose is listing conditions that cause
  an agent to select this skill — the merged instructions must open with an
  equivalent block. Merge the trigger conditions from both sources (removing
  duplicates). Do not move this block into the body or omit it.
- **Human review gate preservation.** Any instruction that requires a human to
  approve, review, or confirm output before it is sent or acted on must be
  preserved verbatim. These are identifiable by phrases such as "do not send
  directly", "do not post without approval", "review before sending", "human
  approval required", "present to user for confirmation", or any sentence that
  explicitly prohibits the skill from taking an action without human sign-off.
  These phrases must survive the merge unchanged. They may be consolidated if
  both source skills contain equivalent gates, but neither may be softened or
  removed.
- **Tool reference preservation.** Any backtick-wrapped name that refers to
  another skill (e.g., \`skill-name\`, \`tool-name\`) in either source skill
  represents an explicit dependency. All such references must appear in the
  merged output. If the reference appears in a sentence that is being rewritten,
  rewrite the sentence to preserve the reference. Do not remove a tool reference
  in the name of de-duplication unless the identical reference already exists
  elsewhere in the merged output.

### Soft constraints (follow unless they conflict with hard constraints)

- **You may lightly restructure or rewrite sections for clarity and flow** as
  long as no meaning or unique information is lost. Preserving clarity is more
  important than preserving exact sentence structure.
- **Section ordering.** Reorder sections so the merged instructions follow this
  canonical sequence:
  1. Invocation trigger / When to use (if present — must be first)
  2. Context / Background / How the skill works
  3. Step-by-step workflow / Execution
  4. Examples (if present)
  5. Output format / Response format / Template (if present — must be last before
     Related Skills)
  6. Related Skills / See Also (if present — always last)

  Sections that do not fit cleanly into categories 2–4 should preserve their
  order relative to the base skill. "Output format" is any section whose primary
  content is a structural template or schema for the skill's response — it always
  goes in position 5 regardless of where it appeared in the source skills.
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
- Section order follows the canonical sequence: trigger → context → workflow → examples → output format → related skills.
- If either source had an invocation trigger block, the merged instructions open with one.
- All human-review-gate instructions from both sources are preserved verbatim.
- Every backtick-wrapped tool/skill reference from both sources appears in the merged output.
- The output format / template section (if present) is the last substantive section before Related Skills.
- If the merged instructions are more than 30% longer than the richer source skill, trim out-of-scope content before returning.
- Instructions read cleanly from start to finish as a single authored document
- \`definition.input_schema\` is valid JSON with no duplicate keys
- The response is complete — no trailing "..." or cut-off content
If any issue is found, fix it before returning.

### Merge rationale (required for PARTIAL_OVERLAP / IMPROVEMENT)

After the self-check, write a \`mergeRationale\` string (2–5 sentences) that answers:
1. Which skill became the base and why (the one with richer instructions, or the
   incoming if it was substantially more comprehensive).
2. What unique content was added from the non-base skill.
3. What, if anything, was dropped during deduplication and the justification for
   dropping it.

This field is shown to the human reviewer as a summary of the AI's merge decisions.
Write it for a reviewer who needs to quickly assess whether the merge is trustworthy,
not for the AI's internal reasoning.

For DUPLICATE and DISTINCT classifications, OMIT the \`proposedMerge\` field
entirely (or set it to null) — there is nothing to merge.

The proposedMerge object has exactly five fields:
- \`name\` — string. Prefer the incoming skill's name/slug if it is more
  descriptive or better reflects the merged scope; otherwise keep the existing.
- \`description\` — string. Prefer a trigger-style description (explaining WHEN
  to invoke this skill) over a one-liner summary if one skill has it and the
  other does not — trigger descriptions are more useful for agent routing.
- \`definition\` — the Anthropic tool definition JSON object (\`name\`,
  \`description\`, \`input_schema\`). NEVER a string. Merge rules:
    • \`name\` — match the chosen \`name\` field above (snake_case slug).
    • \`description\` — use the richer/more complete description.
    • \`input_schema.required\` — preserve all required fields from **both**
      source skills. You may not silently demote a required field to optional.
      The merged required array must be a superset of the union of required
      arrays from both skills. If dropping a field is genuinely necessary,
      justify it in \`mergeRationale\`.
    • \`input_schema.properties\` — union both sets. For parameters that exist
      in both, use the more detailed \`description\`. For enum fields, union
      the enum values from both skills (e.g. if one supports google/meta and
      the other adds tiktok/twitter, the merged enum includes all four).
      New optional parameters from the non-base are added as optional fields.
    • Preserve all file path references, tool names, and markdown links
      exactly as they appear in the source skill — do not alter or invent them.
- \`instructions\` — string OR null
- \`mergeRationale\` — string (2–5 sentences). Which skill became the base and
  why. What unique content was added from the non-base. What, if anything, was
  dropped during deduplication and the justification. Write for a human reviewer
  who needs to quickly assess whether the merge is trustworthy.

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
    "instructions": "...",
    "mergeRationale": "..."
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
  // instead of a decimal (0.85). Only normalise when raw >= 2 (clearly a percentage
  // integer) — values in (1, 2) are genuinely out of range and should return null.
  if (typeof p.confidence !== 'number') return null;
  const raw = p.confidence;
  const confidence = raw >= 2 ? raw / 100 : raw;
  if (confidence < 0 || confidence > 1) return null;
  if (typeof p.reasoning !== 'string') return null;

  const classification = p.classification;
  let proposedMerge: ProposedMerge | null = null;
  if (classification === 'PARTIAL_OVERLAP' || classification === 'IMPROVEMENT') {
    if (p.proposedMerge !== undefined && p.proposedMerge !== null) {
      if (isValidProposedMerge(p.proposedMerge)) {
        proposedMerge = {
          ...p.proposedMerge,
          mergeRationale: typeof p.proposedMerge.mergeRationale === 'string'
            ? p.proposedMerge.mergeRationale
            : undefined,
        };
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
// Merge Validation Helpers
// ---------------------------------------------------------------------------

/** Word count of skill instructions — used for scope expansion arithmetic only.
 *  Do NOT use for base selection; use richnessScore for that. */
function wordCount(text: string | null): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Richness score for base skill selection. Weights headings and code blocks
 *  heavily over raw word count — structured skills are harder to reconstruct
 *  if used as the non-base. */
export function richnessScore(text: string | null): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const headings = (text.match(/^#{1,4}\s/gm)?.length ?? 0) * 50;
  const codeBlocks = (text.match(/```/g)?.length ?? 0) * 100;
  return words + headings + codeBlocks;
}

const GENERIC_BIGRAMS = new Set([
  'email marketing', 'content strategy', 'lead generation', 'social media',
  'marketing strategy', 'brand voice', 'target audience', 'content creation',
  'digital marketing', 'conversion rate',
]);

function isGenericBigram(bigram: string): boolean {
  return GENERIC_BIGRAMS.has(bigram);
}

/** Extract non-trivial word bigrams from a short description text.
 *  Stopwords and single-character tokens are excluded. Returns lowercase bigrams. */
function extractDescriptionBigrams(text: string): Set<string> {
  const STOPWORDS = new Set(['a','an','the','and','or','for','to','of','in',
    'on','with','that','this','is','are','be','it','as','by','at','from']);
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
  const bigrams = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i+1]}`);
  }
  return bigrams;
}

// Leading whitespace is allowed: the block is detected even if the LLM adds
// a blank line before it. Matches from the first invocation keyword through
// the next blank line (or end of string).
const INVOCATION_TRIGGER_RE = /^\s*(Invoke|Use|Call|Trigger)\s+this\s+skill\b.+?(?:\n\n|$)/is;

/** Extract the opening invocation trigger block from skill instructions, if present.
 *  Returns the trimmed block text, or null if no trigger block is found at the top. */
export function extractInvocationBlock(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(INVOCATION_TRIGGER_RE);
  return match?.[0]?.trim() ?? null;
}

const HITL_PHRASES = [
  /do not send (this|the|it)\b.*?directly/i,
  /do not post without approval/i,
  /review before sending/i,
  /human approval required/i,
  /present to (the )?user for (review|confirmation|approval)/i,
  /requires? (human|manual) (review|approval|sign-?off)/i,
];

/** Returns true if the text contains any known HITL gate phrase. */
export function containsHitlGate(text: string | null): boolean {
  if (!text) return false;
  return HITL_PHRASES.some(re => re.test(text));
}

/** Returns true if the text contains any approval/review intent signal,
 *  regardless of exact phrasing. Used as fallback after containsHitlGate. */
export function containsApprovalIntent(text: string | null): boolean {
  if (!text) return false;
  return /\b(approval|approvals|review|confirm\w*|sign-?off)\b/i.test(text);
}

const OUTPUT_FORMAT_HEADING_RE = /^#{1,4}\s+(output\s+format|response\s+format|format|template)\b/im;

/** Returns true if the text contains an output format heading or a fenced code
 *  block whose surrounding context references output/response/format/template. */
export function hasOutputFormatBlock(text: string | null): boolean {
  if (!text) return false;
  if (OUTPUT_FORMAT_HEADING_RE.test(text)) return true;
  const fenceRe = /```(?:json|yaml|markdown|text|html)?\s*\n[\s\S]{0,200}?\b(output|response|format|template|result)\b/i;
  return fenceRe.test(text) || /\b(output|response|format|template|result)\b[\s\S]{0,100}?```/i.test(text);
}

interface ExtractedTable {
  headerKey: string;   // pipe-separated header cells, lowercased and trimmed
  rowCount: number;    // data rows only (header + separator excluded)
}

/** Name-mismatch detection (Fix 7).
 *
 * Compares the four locations where a skill name appears:
 *   - top-level merged.name (file-level)
 *   - merged.definition.name (tool schema)
 *   - any name reference inside merged.description
 *   - any name reference inside merged.instructions
 *
 * Returns null if all four are consistent (or fewer than two distinct names
 * appear). Otherwise, returns a structured mismatch object the UI resolution
 * picker consumes.
 */
export interface NameMismatch {
  topLevel: string;
  schemaName: string | null;
  distinctNames: string[];
  candidates: Array<'top_level' | 'schema' | 'description' | 'instructions' | 'incoming_skill'>;
}

export function detectNameMismatch(
  merged: ProposedMerge,
  /** The incoming candidate's original name. When the rule-based merger (or LLM)
   *  adopts the library name as default, the rename would otherwise be silent.
   *  Passing the incoming name here surfaces it as a NAME_MISMATCH so the
   *  reviewer explicitly confirms or overrides the rename (v3 Fix 7). */
  incomingName?: string,
): NameMismatch | null {
  const topLevel = (merged.name ?? '').trim();
  const schemaNameRaw = (merged.definition as Record<string, unknown> | null | undefined)?.name;
  const schemaName = typeof schemaNameRaw === 'string' && schemaNameRaw.trim().length > 0
    ? schemaNameRaw.trim()
    : null;
  if (!topLevel && !schemaName) return null;

  const normalise = (s: string) => s.toLowerCase().replace(/[-_]+/g, '_').trim();
  const candidates = new Set<string>();
  if (topLevel) candidates.add(normalise(topLevel));
  if (schemaName) candidates.add(normalise(schemaName));

  // If the incoming skill had a different name (merger defaulted to library name),
  // surface it as an additional candidate so the reviewer sees and resolves the rename.
  const normIncoming = incomingName ? normalise(incomingName) : null;
  if (normIncoming && topLevel && normIncoming !== normalise(topLevel)) {
    candidates.add(normIncoming);
  }

  // Look for either name used as a bare identifier in description / instructions.
  // Only flag when a DIFFERENT name appears there, not the same one.
  const allBareNames = collectBareNames(merged.description)
    .concat(collectBareNames(merged.instructions))
    .map(normalise);
  for (const n of allBareNames) {
    candidates.add(n);
  }

  if (candidates.size < 2) return null;

  const sources: Array<'top_level' | 'schema' | 'description' | 'instructions' | 'incoming_skill'> = [];
  if (topLevel) sources.push('top_level');
  if (schemaName) sources.push('schema');
  if (merged.description && collectBareNames(merged.description).length > 0) sources.push('description');
  if (merged.instructions && collectBareNames(merged.instructions).length > 0) sources.push('instructions');
  if (normIncoming && topLevel && normIncoming !== normalise(topLevel)) sources.push('incoming_skill');

  return {
    topLevel,
    schemaName,
    distinctNames: [...candidates],
    candidates: sources,
  };
}

/** Collect bare-identifier name-like tokens (lowercase letters / digits /
 *  underscores / hyphens, ≥3 chars) that look like skill slugs or tool names.
 *  Used as a heuristic for detecting stale references inside prose. */
function collectBareNames(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  const re = /`([a-z][a-z0-9_-]{2,})`|\b([a-z][a-z0-9_]{3,})\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = (m[1] ?? m[2] ?? '').trim();
    if (token.length >= 3 && /[_-]/.test(token)) {
      out.push(token);
    }
  }
  return out;
}

/** Extract markdown tables from text, keyed by their normalized header row.
 *  headerKey is context-qualified: "{nearest-heading}>{columns}" when a
 *  heading is present, otherwise just "{columns}". This prevents platform-
 *  spec tables that share identical column schemas (e.g. "element|limit|notes"
 *  appearing under Meta, LinkedIn, TikTok, and Twitter/X sections) from
 *  collapsing into a single bucket and cross-polluting each other's rows. */
export function extractTables(text: string | null): ExtractedTable[] {
  if (!text) return [];
  const lines = text.split('\n');
  const tables: ExtractedTable[] = [];
  let inTable = false;
  let headerKey: string | null = null;
  let rowCount = 0;
  let lineIndex = 0;
  let contextHeading = '';

  for (const line of lines) {
    const trimmed = line.trim();
    // Track the nearest heading so tables with identical column schemas but
    // under different section headings get distinct keys.
    if (!inTable && /^#{1,4}\s+/.test(trimmed)) {
      contextHeading = trimmed.replace(/^#+\s+/, '').trim().toLowerCase();
    }
    if (trimmed.startsWith('|')) {
      if (!inTable) {
        inTable = true;
        const rawKey = trimmed.replace(/^\||\|$/g, '').split('|')
          .map(c => c.trim().toLowerCase()).join('|');
        headerKey = contextHeading ? `${contextHeading}>${rawKey}` : rawKey;
        rowCount = 0;
        lineIndex = 0;
      } else {
        lineIndex++;
        if (lineIndex === 1 && /^\|[\s\-:|]+\|/.test(trimmed)) continue;
        rowCount++;
      }
    } else if (inTable) {
      if (headerKey !== null) tables.push({ headerKey, rowCount });
      inTable = false;
      headerKey = null;
      rowCount = 0;
      lineIndex = 0;
    }
  }
  if (inTable && headerKey !== null) tables.push({ headerKey, rowCount });
  return tables;
}

const MAX_MERGE_WARNINGS = 10;

/** Full-row table representation used by remediateTables. */
interface ExtractedTableRows {
  headerLine: string;           // the raw header line (with pipes)
  headerKey: string;            // normalized pipe-joined header
  separatorLine: string;        // the |---|---| row
  columnCount: number;
  rows: string[];               // raw row lines
  startLineIndex: number;       // line index of the header in source text
  endLineIndex: number;         // line index of last row (exclusive)
}

/** Extract tables with full row content, keyed by context-qualified header.
 *  See extractTables for the heading-context rationale. */
export function extractTablesWithRows(text: string | null): ExtractedTableRows[] {
  if (!text) return [];
  const lines = text.split('\n');
  const tables: ExtractedTableRows[] = [];
  let current: ExtractedTableRows | null = null;
  let linePos = 0;
  let contextHeading = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!current && /^#{1,4}\s+/.test(trimmed)) {
      contextHeading = trimmed.replace(/^#+\s+/, '').trim().toLowerCase();
    }
    if (trimmed.startsWith('|')) {
      if (!current) {
        const headerCells = trimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const rawKey = headerCells.map(c => c.toLowerCase()).join('|');
        current = {
          headerLine: line,
          headerKey: contextHeading ? `${contextHeading}>${rawKey}` : rawKey,
          separatorLine: '',
          columnCount: headerCells.length,
          rows: [],
          startLineIndex: i,
          endLineIndex: i + 1,
        };
        linePos = 0;
      } else {
        linePos++;
        if (linePos === 1 && /^\|[\s\-:|]+\|/.test(trimmed)) {
          current.separatorLine = line;
          current.endLineIndex = i + 1;
          continue;
        }
        current.rows.push(line);
        current.endLineIndex = i + 1;
      }
    } else if (current) {
      tables.push(current);
      current = null;
    }
  }
  if (current) tables.push(current);
  return tables;
}

/** First-column key for row deduplication. Strips leading/trailing pipes
 *  and lowercases the first cell. Empty cells return ''. */
function firstColumnKey(rowLine: string): string {
  const trimmed = rowLine.trim().replace(/^\|/, '');
  const firstPipe = trimmed.indexOf('|');
  const cell = firstPipe >= 0 ? trimmed.slice(0, firstPipe) : trimmed;
  return cell.trim().toLowerCase();
}

/** Whether a row already carries a [SOURCE: ...] marker (skip to prevent
 *  recursive inflation on retries). */
function hasSourceMarker(rowLine: string): boolean {
  return /\[SOURCE:\s*(library|incoming)/i.test(rowLine);
}

/** Append a `[SOURCE: ...]` marker to the last non-empty cell of a row.
 *  When `sourceKey` is provided (heading-qualified headerKey of the source
 *  table), it is embedded in the annotation so decontaminateSectionRows can
 *  detect cross-section row pollution. */
function withSourceMarker(
  rowLine: string,
  source: 'library' | 'incoming',
  sourceKey?: string,
): string {
  const trimmed = rowLine.trimEnd();
  if (hasSourceMarker(trimmed)) return trimmed;
  const marker = sourceKey
    ? `[SOURCE: ${source} "${sourceKey}"]`
    : `[SOURCE: ${source}]`;
  if (trimmed.endsWith('|')) {
    return trimmed.slice(0, -1).trimEnd() + ` ${marker} |`;
  }
  return `${trimmed} ${marker}`;
}

// ---------------------------------------------------------------------------
// Post-remediation cleanup — decontamination + annotation strip
// ---------------------------------------------------------------------------

/** Remove table rows that were appended by remediateTables into the wrong
 *  section. Detects misplacement by comparing the source section key
 *  embedded in the annotation against the current section context.
 *
 *  Only rows with an extended annotation `[SOURCE: ... "key"]` are examined;
 *  legacy bare `[SOURCE: library]` rows are left for stripSourceAnnotations.
 *
 *  Domain-agnostic: comparison is pure string match on heading keys; no
 *  hardcoded platform names.
 *
 *  Idempotent: running twice on the same text produces the same result. */
export function decontaminateSectionRows(instructions: string): string {
  const lines = instructions.split('\n');
  let contextKey = '';
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Update current section heading whenever we see a heading-level line.
    // We DON'T require !inTable here because headings inside remediateTables
    // output can follow a table with no blank line separator.
    if (/^#{1,4}\s+/.test(trimmed)) {
      contextKey = trimmed.replace(/^#+\s+/, '').trim().toLowerCase();
    }

    if (trimmed.startsWith('|')) {
      // Check for extended SOURCE annotation with an embedded section key.
      const match = trimmed.match(/\[SOURCE:\s*(?:library|incoming)\s+"([^"]+)"\]/i);
      if (match) {
        const sourceKey = match[1];
        // Source key format: "<heading>><columns>" — extract heading part.
        const sourceHeading = sourceKey.includes('>') ? sourceKey.split('>')[0] : sourceKey;
        // If source heading differs from current section heading, this row
        // was appended into the wrong section — discard it.
        if (contextKey && sourceHeading && sourceHeading !== contextKey) {
          continue;
        }
      }
    }

    result.push(line);
  }
  return result.join('\n');
}

/** Strip all [SOURCE: library] / [SOURCE: incoming] annotations from table
 *  rows. These are internal merge-process artifacts and must not appear in
 *  the user-facing merged output.
 *
 *  Removes both the legacy bare form and the extended keyed form:
 *    [SOURCE: library]
 *    [SOURCE: incoming "meta ads>element|limit|notes"]
 *
 *  Idempotent. */
export function stripSourceAnnotations(instructions: string): string {
  return instructions.replace(
    /\s*\[SOURCE:\s*(?:library|incoming)(?:\s+"[^"]*")?\]/gi,
    '',
  );
}

export interface RemediateTablesInput {
  mergedInstructions: string;
  baseInstructions: string | null;          // library skill instructions
  incomingInstructions: string | null;      // candidate skill instructions
  /** Abort auto-recovery if remediated word count exceeds this multiple of
   *  the pre-remediation word count (§11.11.9). */
  maxGrowthRatio?: number;
}

export interface RemediateTablesOutput {
  instructions: string;
  autoRecoveredRows: number;
  skippedDueToColumnMismatch: number;
  skippedDueToKeyConflict: number;
  growthRatioExceeded: boolean;
}

/**
 * Post-process merged instructions to append missing table rows from the
 * source skills, marking each recovered row with [SOURCE: library|incoming].
 * Refuses to merge when column schemas differ or when first-column keys
 * conflict across sources (§11.11.6). Honors max_table_growth_ratio.
 */
export function remediateTables(input: RemediateTablesInput): RemediateTablesOutput {
  const { mergedInstructions, baseInstructions, incomingInstructions } = input;
  const maxGrowthRatio = input.maxGrowthRatio ?? 1.5;

  const baseTables = extractTablesWithRows(baseInstructions);
  const incomingTables = extractTablesWithRows(incomingInstructions);
  const mergedTables = extractTablesWithRows(mergedInstructions);

  // Source table lookup: header -> { source, rows }
  const sourceByHeader = new Map<string, Array<{ source: 'library' | 'incoming'; table: ExtractedTableRows }>>();
  for (const t of baseTables) {
    const list = sourceByHeader.get(t.headerKey) ?? [];
    list.push({ source: 'library', table: t });
    sourceByHeader.set(t.headerKey, list);
  }
  for (const t of incomingTables) {
    const list = sourceByHeader.get(t.headerKey) ?? [];
    list.push({ source: 'incoming', table: t });
    sourceByHeader.set(t.headerKey, list);
  }

  let autoRecovered = 0;
  let skippedColumn = 0;
  let skippedKeyConflict = 0;

  // Process tables in reverse line order so line-index splices stay valid.
  const lines = mergedInstructions.split('\n');
  const sortedMergedTables = [...mergedTables].sort((a, b) => b.startLineIndex - a.startLineIndex);

  for (const mergedTable of sortedMergedTables) {
    const sources = sourceByHeader.get(mergedTable.headerKey) ?? [];
    if (sources.length === 0) continue;

    // Guard 1: column mismatch (any source with different column count).
    if (sources.some(s => s.table.columnCount !== mergedTable.columnCount)) {
      skippedColumn++;
      continue;
    }

    const existingKeys = new Set(
      mergedTable.rows
        .filter(r => !hasSourceMarker(r))
        .map(firstColumnKey),
    );

    // Collect candidate rows to append, skipping those whose first-column
    // key is already present (or conflicts across sources).
    const seenSourceKey = new Map<string, 'library' | 'incoming'>();
    const toAppend: Array<{ row: string; source: 'library' | 'incoming'; sourceTableKey: string }> = [];
    for (const { source, table } of sources) {
      for (const row of table.rows) {
        if (hasSourceMarker(row)) continue;
        const key = firstColumnKey(row);
        if (!key) continue;
        if (existingKeys.has(key)) continue;
        const prior = seenSourceKey.get(key);
        if (prior && prior !== source) {
          // Cross-source conflict: skip this row entirely.
          skippedKeyConflict++;
          continue;
        }
        seenSourceKey.set(key, source);
        // Include source table's headerKey so decontaminateSectionRows can
        // detect rows appended into the wrong section.
        toAppend.push({ row, source, sourceTableKey: table.headerKey });
      }
    }

    if (toAppend.length === 0) continue;

    // Append the new rows with extended SOURCE annotations that encode the
    // source table's heading context for downstream decontamination.
    const markedRows = toAppend.map(({ row, source, sourceTableKey }) =>
      withSourceMarker(row, source, sourceTableKey),
    );
    // Splice after the last merged-table row (mergedTable.endLineIndex).
    lines.splice(mergedTable.endLineIndex, 0, ...markedRows);
    autoRecovered += markedRows.length;
  }

  let nextText = lines.join('\n');

  // Guard 2: aggregate growth ratio. Only enforced for non-trivial inputs;
  // small tables would otherwise trip the cap on a single auto-recovered row.
  const preWords = countWords(mergedInstructions);
  const postWords = countWords(nextText);
  const GROWTH_CAP_MIN_WORDS = 100;
  const growthRatioExceeded =
    preWords >= GROWTH_CAP_MIN_WORDS &&
    postWords / preWords > maxGrowthRatio;
  if (growthRatioExceeded) {
    // Abort: return original.
    nextText = mergedInstructions;
    autoRecovered = 0;
  }

  return {
    instructions: nextText,
    autoRecoveredRows: autoRecovered,
    skippedDueToColumnMismatch: skippedColumn,
    skippedDueToKeyConflict: skippedKeyConflict,
    growthRatioExceeded,
  };
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Skill graph collision detection — v2 Fix 3
// ---------------------------------------------------------------------------

export interface SkillGraphCollisionCheckInput {
  merged: ProposedMerge;
  libraryCatalog: ReadonlyArray<{ id: string | null; slug: string; name: string; instructions: string | null }>;
  sessionApprovedSlugs?: ReadonlySet<string>;      // other approved results in same session
  excludedId: string | null;                        // the matched-against skill (not a collision)
  /** Minimum fragment-overlap ratio to surface the warning. Default 0.40. */
  threshold?: number;
  /** Max number of top-K candidate skills to fragment-compare against. */
  maxCandidates?: number;
  /** Hard cap on fragment-pair comparisons per candidate (budget). */
  maxPairComparisons?: number;
}

export interface SkillGraphCollision {
  collidingSkillId: string | null;
  collidingSlug: string;
  collidingName: string;
  overlapRatio: number;
  overlappingFragments: string[];   // first line of each overlapping fragment
}

/**
 * Compare merged skill against the library catalog + session-approved set
 * to detect capability-fragment overlap. Pragmatic bigram-based implementation
 * that respects the §11.5 performance caps (top-K + budget).
 */
export function detectSkillGraphCollision(input: SkillGraphCollisionCheckInput): SkillGraphCollision[] {
  const threshold = input.threshold ?? 0.40;
  const maxCandidates = input.maxCandidates ?? 20;
  const maxPairs = input.maxPairComparisons ?? 200;
  const sessionApproved = input.sessionApprovedSlugs ?? new Set<string>();

  const mergedFragments = splitCapabilityFragments(input.merged.instructions);
  if (mergedFragments.length === 0) return [];

  // Pre-filter: skip the matched-against skill, skip anything with no bigram
  // overlap at all (cheap keyword check), rank by overall description + name
  // bigram overlap.
  const mergedDescBigrams = extractDescriptionBigrams(input.merged.description);
  type Scored = { skill: (typeof input.libraryCatalog)[number]; preScore: number };
  const preScored: Scored[] = [];
  for (const skill of input.libraryCatalog) {
    if (skill.id !== null && skill.id === input.excludedId) continue;
    // Allow session-approved slugs to flow through as additional collision
    // targets even if their id is null (synthesised from the job's approved set).
    const isSession = sessionApproved.has(skill.slug);
    if (!isSession && skill.id === null) continue;

    const otherBigrams = extractDescriptionBigrams(
      `${skill.name} ${skill.instructions?.slice(0, 2000) ?? ''}`,
    );
    let preScore = 0;
    for (const bg of mergedDescBigrams) if (otherBigrams.has(bg) && !isGenericBigram(bg)) preScore++;
    if (preScore === 0) continue;
    preScored.push({ skill, preScore });
  }

  preScored.sort((a, b) => b.preScore - a.preScore);
  const top = preScored.slice(0, maxCandidates);

  const collisions: SkillGraphCollision[] = [];
  let pairBudget = maxPairs;
  for (const { skill } of top) {
    const otherFragments = splitCapabilityFragments(skill.instructions ?? '');
    if (otherFragments.length === 0) continue;

    // Count overlapping fragment pairs by bigram ratio.
    const overlapping: string[] = [];
    let pairs = 0;
    outer: for (const mf of mergedFragments) {
      if (pairBudget <= 0) break;
      const mfBigrams = extractDescriptionBigrams(mf.body);
      for (const of of otherFragments) {
        if (pairBudget-- <= 0) break outer;
        pairs++;
        const ofBigrams = extractDescriptionBigrams(of.body);
        const denom = Math.min(mfBigrams.size, ofBigrams.size);
        if (denom < 3) continue;
        let shared = 0;
        for (const bg of mfBigrams) if (ofBigrams.has(bg) && !isGenericBigram(bg)) shared++;
        const ratio = shared / denom;
        if (ratio >= threshold) {
          overlapping.push(mf.heading || '(unnamed fragment)');
          break;
        }
      }
    }

    if (overlapping.length === 0) continue;
    const overlapRatio = overlapping.length / Math.max(1, mergedFragments.length);
    if (overlapRatio < threshold / 2) continue;  // require at least half-threshold

    collisions.push({
      collidingSkillId: skill.id,
      collidingSlug: skill.slug,
      collidingName: skill.name,
      overlapRatio,
      overlappingFragments: overlapping,
    });
  }

  return collisions;
}

function splitCapabilityFragments(text: string | null): Array<{ heading: string; body: string }> {
  if (!text) return [];
  return splitH2Sections(text);
}



/** Thresholds injected into validateMergeOutput from the config snapshot. */
export interface ValidationThresholds {
  scopeExpansionStandardPct?: number;   // decimal fraction, e.g. 0.40
  scopeExpansionCriticalPct?: number;   // decimal fraction, e.g. 0.75
  tierMap?: Record<string, WarningTier>;
}

/**
 * Post-processing validator for LLM-generated merge output.
 * Pure — no DB, no clock. Returns an array of structured warnings.
 * An empty array means no issues were detected.
 *
 * Thresholds are read from the optional `thresholds` parameter (captured from
 * the job's config_snapshot). Defaults preserve pre-v2 behaviour when absent.
 */
export function validateMergeOutput(
  base: { definition: object | null; instructions: string | null; invocationBlock?: string | null },
  nonBase: { definition: object | null; instructions: string | null; invocationBlock?: string | null },
  merged: ProposedMerge,
  allLibraryNames: ReadonlySet<string>,
  allLibrarySlugs: ReadonlySet<string>,
  allLibrarySkills: ReadonlyArray<{ id: string | null; name: string; description: string }>,
  excludedId: string | null,
  thresholds: ValidationThresholds = {},
  /** Optional: the incoming candidate's original name, used by detectNameMismatch
   *  to surface rename decisions the merger made silently. */
  candidateName?: string,
): MergeWarning[] {
  const warnings: MergeWarning[] = [];
  const scopeStd = Math.round((thresholds.scopeExpansionStandardPct ?? 0.30) * 100);
  const scopeCrit = Math.round((thresholds.scopeExpansionCriticalPct ?? 0.60) * 100);
  const tierMap = thresholds.tierMap ?? DEFAULT_WARNING_TIER_MAP;

  // --- Bug 1: Required field demotion ---
  const baseRequired: string[] = (base.definition as Record<string, unknown> | null)?.input_schema
    ? ((base.definition as Record<string, Record<string, unknown>>).input_schema?.required as string[] ?? [])
    : [];
  const nonBaseRequired: string[] = (nonBase.definition as Record<string, unknown> | null)?.input_schema
    ? ((nonBase.definition as Record<string, Record<string, unknown>>).input_schema?.required as string[] ?? [])
    : [];
  const mergedRequired: string[] = (merged.definition as Record<string, unknown> | null)?.input_schema
    ? ((merged.definition as Record<string, Record<string, unknown>>).input_schema?.required as string[] ?? [])
    : [];

  const allSourceRequired = [...new Set([...baseRequired, ...nonBaseRequired])];
  const demoted = allSourceRequired.filter(f => !mergedRequired.includes(f));
  if (demoted.length > 0) {
    warnings.push({
      code: 'REQUIRED_FIELD_DEMOTED',
      severity: 'critical',
      message: `${demoted.length} required field(s) from the source skills were made optional or removed.`,
      // Structured detail so the client can render per-field Accept/Restore UI.
      // parseDemotedFields() still accepts the legacy comma-delimited form for
      // backwards compatibility.
      detail: JSON.stringify({ demotedFields: demoted }),
    });
  }

  // --- Bug 2: Capability overlap (name collision fast-check first) ---
  const mergedNameLower = merged.name.toLowerCase();
  if (allLibraryNames.has(mergedNameLower) || allLibrarySlugs.has(mergedNameLower)) {
    warnings.push({
      code: 'CAPABILITY_OVERLAP',
      severity: 'critical',
      message: `The merged name "${merged.name}" already exists in the skill library.`,
      detail: merged.name,
    });
  } else {
    // Bigram overlap check
    const mergedBigrams = extractDescriptionBigrams(merged.description);
    for (const skill of allLibrarySkills) {
      if (skill.id === excludedId) continue;
      const otherBigrams = extractDescriptionBigrams(skill.description);
      const overlap = [...mergedBigrams]
        .filter(b => otherBigrams.has(b))
        .filter(b => !isGenericBigram(b));
      const denom = Math.min(mergedBigrams.size, otherBigrams.size);
      const overlapRatio = denom > 0 ? overlap.length / denom : 0;
      if (overlap.length >= 2 && overlapRatio > 0.2) {
        warnings.push({
          code: 'CAPABILITY_OVERLAP',
          severity: 'warning',
          message: `Merged skill may overlap in purpose with "${skill.name}".`,
          detail: overlap.slice(0, 5).join(', '),
        });
      }
    }
  }

  // --- Bug 8: Scope expansion (thresholds from config snapshot) ---
  const baseWords = wordCount(base.instructions);
  const nonBaseWords = wordCount(nonBase.instructions);
  const richerSourceWords = Math.max(baseWords, nonBaseWords);
  const mergedWords = wordCount(merged.instructions);
  if (richerSourceWords > 0) {
    const pct = Math.round((mergedWords / richerSourceWords - 1) * 100);
    if (pct > scopeCrit) {
      warnings.push({
        code: 'SCOPE_EXPANSION_CRITICAL',
        severity: 'critical',
        message: `Merged instructions are ${pct}% longer than the richer source skill — likely out-of-scope content was imported.`,
        detail: `richer source: ${richerSourceWords} words, merged: ${mergedWords} words`,
      });
    } else if (pct > scopeStd) {
      warnings.push({
        code: 'SCOPE_EXPANSION',
        severity: 'warning',
        message: `Merged instructions are ${pct}% longer than the richer source skill. Review for scope creep.`,
        detail: `richer source: ${richerSourceWords} words, merged: ${mergedWords} words`,
      });
    }
  }

  // --- Bug 10: Table completeness ---
  const baseTables = extractTables(base.instructions);
  const nonBaseTables = extractTables(nonBase.instructions);
  const mergedTables = extractTables(merged.instructions);
  const mergedByHeader = new Map(mergedTables.map(t => [t.headerKey, t.rowCount]));
  const sourceLookup = new Map<string, number>();
  for (const t of [...baseTables, ...nonBaseTables]) {
    const existing = sourceLookup.get(t.headerKey) ?? 0;
    if (t.rowCount > existing) sourceLookup.set(t.headerKey, t.rowCount);
  }
  for (const [headerKey, sourceRows] of sourceLookup) {
    const mergedRows = mergedByHeader.get(headerKey) ?? 0;
    if (mergedRows < sourceRows) {
      warnings.push({
        code: 'TABLE_ROWS_DROPPED',
        severity: 'warning',
        message: `Table "${headerKey}" has ${mergedRows} rows in the merge but ${sourceRows} in the source.`,
        detail: `header: ${headerKey}, source rows: ${sourceRows}, merged rows: ${mergedRows}`,
      });
    }
  }

  // --- Bug 3 post-check: Invocation block preservation ---
  const sourceHasInvocation = !!(base.invocationBlock || nonBase.invocationBlock);
  if (sourceHasInvocation) {
    let mergedHasInvocationAtTop = false;
    if (merged.instructions) {
      const triggerMatch = merged.instructions.match(INVOCATION_TRIGGER_RE);
      mergedHasInvocationAtTop = triggerMatch !== null
        && merged.instructions.trimStart().startsWith(triggerMatch[0].trimStart());
    }
    if (!mergedHasInvocationAtTop) {
      warnings.push({
        code: 'INVOCATION_LOST',
        severity: 'critical',
        message: 'One or both source skills had an invocation trigger block that is missing or not at the top of the merged output.',
      });
    }
  }

  // --- Bug 4 post-check: HITL gate preservation ---
  const sourceHasHitl = containsHitlGate(base.instructions) || containsHitlGate(nonBase.instructions);
  if (sourceHasHitl
    && !containsHitlGate(merged.instructions)
    && !containsApprovalIntent(merged.instructions)) {
    warnings.push({
      code: 'HITL_LOST',
      severity: 'critical',
      message: 'A human review gate instruction from a source skill is missing from the merged output.',
    });
  }

  // --- Bug 7 post-check: Output format block preservation ---
  const sourceHasFormat = hasOutputFormatBlock(base.instructions) || hasOutputFormatBlock(nonBase.instructions);
  if (sourceHasFormat && !hasOutputFormatBlock(merged.instructions)) {
    warnings.push({
      code: 'OUTPUT_FORMAT_LOST',
      severity: 'warning',
      message: 'Source skill(s) had an output format or code block specification that is not present in the merged output.',
    });
  }

  // --- Fix 7: Name mismatch across file name / schema name / references ---
  const mismatch = detectNameMismatch(merged, candidateName);
  if (mismatch) {
    warnings.push({
      code: 'NAME_MISMATCH',
      severity: 'critical',
      message: `Skill name is inconsistent across ${mismatch.candidates.length} locations. Reviewer must choose one.`,
      detail: JSON.stringify({
        topLevel: mismatch.topLevel,
        schemaName: mismatch.schemaName,
        distinctNames: mismatch.distinctNames,
        candidates: mismatch.candidates,
      }),
    });
  }

  // --- Fix 4 (v4/v5): NEAR_REPLACEMENT — merged retains < 30% of source structure ---
  const retentionScore = computeSourceRetention(base, merged, sourceLookup, mergedByHeader);
  if (retentionScore < 0.30) {
    const defRet = computeDefinitionRetention(base, merged);
    const tblRet = computeTableRetention(sourceLookup, mergedByHeader);
    const instrRet = wordOverlapRatio(base.instructions, merged.instructions);
    warnings.push({
      code: 'NEAR_REPLACEMENT',
      severity: 'warning',
      message: `This merge retains only ~${Math.round(retentionScore * 100)}% of the library skill's structure. Consider treating as a new skill rather than a merge.`,
      detail: JSON.stringify({
        retentionScore: Math.round(retentionScore * 100),
        definitionRetentionPct: Math.round(defRet * 100),
        tableRetentionPct: Math.round(tblRet * 100),
        instructionRetentionPct: Math.round(instrRet * 100),
      }),
    });
  }

  // Safety cap: prevent unbounded warning list from malformed input.
  // Sort by severity + tier priority so critical codes survive truncation,
  // then cap.
  if (warnings.length > MAX_MERGE_WARNINGS) {
    const sorted = sortWarningsBySeverity(warnings, tierMap);
    warnings.length = 0;
    for (let i = 0; i < MAX_MERGE_WARNINGS - 1 && i < sorted.length; i++) warnings.push(sorted[i]);
    warnings.push({
      code: 'WARNINGS_TRUNCATED',
      severity: 'warning',
      message: `Additional warnings were truncated (more than ${MAX_MERGE_WARNINGS} issues detected).`,
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Rule-based fallback merger — v2 Fix 1
// ---------------------------------------------------------------------------

export interface RuleBasedMergeInput {
  candidate: { name: string; description: string; definition: object | null; instructions: string | null };
  library:   { name: string; description: string; definition: object | null; instructions: string | null };
}

export interface RuleBasedMergeOutput {
  merge: ProposedMerge;
  mergeRationale: string;
}

/**
 * Deterministic merge produced when the LLM classifier is unavailable or
 * returns an invalid response. Preserves invocation blocks, HITL gates, and
 * tool-definition schemas without any model call.
 *
 * Dominant source is chosen as: (1) definition-bearing skill > definition-less,
 * else (2) higher richnessScore of instructions, else (3) library (stable tie-break).
 *
 * Name behaviour (§11.4): always defaults to the library name for DB slug
 * stability; a NAME_MISMATCH warning is emitted separately by
 * validateMergeOutput when candidate and library names differ, and the
 * reviewer resolves that via the normal Fix 7 UI.
 */
export function buildRuleBasedMerge({ candidate, library }: RuleBasedMergeInput): RuleBasedMergeOutput {
  const candidateHasDef = !!candidate.definition && typeof candidate.definition === 'object';
  const libraryHasDef = !!library.definition && typeof library.definition === 'object';

  let dominantKey: 'candidate' | 'library';
  if (libraryHasDef && !candidateHasDef) dominantKey = 'library';
  else if (candidateHasDef && !libraryHasDef) dominantKey = 'candidate';
  else {
    const candidateScore = richnessScore(candidate.instructions);
    const libraryScore = richnessScore(library.instructions);
    // §11.4: tie-break goes to library for DB slug stability. Only when the
    // candidate is strictly richer does it become dominant.
    dominantKey = candidateScore > libraryScore ? 'candidate' : 'library';
  }
  const dominant = dominantKey === 'candidate' ? candidate : library;
  const secondary = dominantKey === 'candidate' ? library : candidate;

  // Name: library default (keeps DB slug predictable). NAME_MISMATCH handles UX.
  const name = library.name || candidate.name;

  // Description: prefer the shorter of the two if both present; else whichever exists.
  let description = '';
  if (candidate.description && library.description) {
    description = candidate.description.length <= library.description.length
      ? candidate.description
      : library.description;
  } else {
    description = candidate.description || library.description || '';
  }

  // Definition: dominant's schema wins; if dominant has none but secondary
  // does, adopt secondary's. When dominant has a definition, overwrite its
  // name field to match the chosen merge name for consistency.
  let definition: object;
  if (dominantKey === 'candidate' && candidateHasDef) definition = candidate.definition as object;
  else if (dominantKey === 'library' && libraryHasDef) definition = library.definition as object;
  else if (candidateHasDef) definition = candidate.definition as object;
  else if (libraryHasDef) definition = library.definition as object;
  else {
    // Neither source has a schema — synthesise a minimal valid shape so
    // downstream validators don't explode.
    definition = {
      name,
      description,
      input_schema: { type: 'object', properties: {}, required: [] as string[] },
    };
  }

  const instructions = mergeInstructionsRuleBased(dominant.instructions, secondary.instructions);

  const sectionCount = (instructions.match(/^##\s+/gm)?.length ?? 0);
  const mergeRationale =
    `Rule-based merge applied — classifier unavailable or output invalid. `
    + `Dominant source: ${dominantKey === 'library' ? 'library' : 'incoming'}. `
    + `Merged instructions have ${sectionCount} top-level section(s). `
    + `Review carefully; confidence is low by default.`;

  return {
    merge: {
      name,
      description,
      definition,
      instructions,
    },
    mergeRationale,
  };
}

// ---------------------------------------------------------------------------
// Classification-failure outcome — single source of truth
// ---------------------------------------------------------------------------
//
// Both the Stage-5 job path (skillAnalyzerJob.ts) and the per-row retry path
// (skillAnalyzerService.ts → classifySingleCandidate) enter the same state
// when the LLM classify call errors or the response can't be parsed. Before
// this helper existed, the two paths diverged: the job applied the rule-based
// fallback (§11.4), while the retry path returned a null-merge stub —
// surfacing "Proposal unavailable" in the UI on every retry. This helper is
// the single authority for the classification-failure outcome so the two
// paths stay in lockstep.

/** Standard copy used when the classifier fails; match this across both
 *  paths so debugging can key off a single string. */
export const CLASSIFIER_FALLBACK_REASONING =
  'LLM classification failed — rule-based fallback merge applied for human review.';

/** Standard CLASSIFIER_FALLBACK warning — prepended to every mergeWarnings
 *  array on the fallback path. */
export const CLASSIFIER_FALLBACK_WARNING: MergeWarning = {
  code: 'CLASSIFIER_FALLBACK',
  severity: 'warning',
  message: 'Rule-based fallback merge applied — classifier unavailable. Review carefully.',
};

export interface ClassifierFailureOutcome {
  classification: 'PARTIAL_OVERLAP';
  confidence: number;
  reasoning: string;
  proposedMerge: ProposedMerge;
  mergeRationale: string;
  classifierFallbackApplied: true;
}

/** Build the complete outcome returned whenever classification fails.
 *  Wraps `buildRuleBasedMerge` with standard reasoning copy, a low-confidence
 *  score (clamped to `fallbackConfidence`, default 0.3), and the
 *  `classifierFallbackApplied` flag. Validation (merge warnings) is applied
 *  separately by the caller — the job and retry paths each compose this
 *  outcome with their own validateMergeOutput / remediateTables plumbing. */
/** Known ad-platform identifiers that the library skill's enum may omit. */
const PLATFORM_PATTERNS: Array<{ pattern: RegExp; enumValue: string }> = [
  { pattern: /\btiktok\b/i,            enumValue: 'tiktok_ads' },
  { pattern: /\btwitter\b|\btwitter\/x\b|\bx ads\b/i, enumValue: 'twitter_x_ads' },
  { pattern: /\bsnapchat\b/i,          enumValue: 'snapchat_ads' },
  { pattern: /\byoutube\b/i,           enumValue: 'youtube_ads' },
  { pattern: /\bpinterest\b/i,         enumValue: 'pinterest_ads' },
];

/** Return a copy of `definition` with any new platform enum values from
 *  `incomingInstructions` injected into the first `enum` field found under
 *  `input_schema.properties`. No-ops if the definition has no enum. */
function expandPlatformEnum(
  definition: object,
  incomingInstructions: string | null,
): object {
  if (!incomingInstructions) return definition;
  const def = definition as Record<string, unknown>;
  const props = (def.input_schema as Record<string, unknown> | undefined)?.properties;
  if (!props || typeof props !== 'object') return definition;

  const propsObj = props as Record<string, unknown>;
  const platformPropKey = Object.keys(propsObj).find(k => {
    const p = propsObj[k] as Record<string, unknown> | undefined;
    return Array.isArray(p?.enum) && (p.enum as string[]).some(v => v.includes('_ads') || v.includes('ads_'));
  });
  if (!platformPropKey) return definition;

  const prop = propsObj[platformPropKey] as Record<string, unknown>;
  const existing = new Set<string>(prop.enum as string[]);
  const toAdd: string[] = [];
  for (const { pattern, enumValue } of PLATFORM_PATTERNS) {
    if (!existing.has(enumValue) && pattern.test(incomingInstructions)) toAdd.push(enumValue);
  }
  if (toAdd.length === 0) return definition;

  return {
    ...def,
    input_schema: {
      ...(def.input_schema as object),
      properties: {
        ...propsObj,
        [platformPropKey]: { ...prop, enum: [...(prop.enum as string[]), ...toAdd] },
      },
    },
  };
}

export function buildClassifierFailureOutcome(
  input: RuleBasedMergeInput & { fallbackConfidence?: number },
): ClassifierFailureOutcome {
  const fallback = buildRuleBasedMerge({
    candidate: input.candidate,
    library: input.library,
  });

  // v5 Fix 1: use incoming name + description; keep library definition but
  // expand any platform enums it has; show clear boundary in instructions.
  const incomingName = input.candidate.name?.trim() ?? '';
  const useName = incomingName || input.library.name?.trim() || fallback.merge.name;

  const incomingDesc = input.candidate.description?.trim() ?? '';
  const useDescription = incomingDesc.length > 50 ? incomingDesc : fallback.merge.description;

  const libInstr  = input.library.instructions?.trim() ?? '';
  const candInstr = input.candidate.instructions?.trim() ?? '';
  let useInstructions: string | null;
  if (libInstr && candInstr) {
    useInstructions = `${libInstr}\n\n---\n\n## Extended Capabilities (from incoming skill)\n\n${candInstr}`;
  } else {
    useInstructions = libInstr || candInstr || fallback.merge.instructions;
  }

  const expandedDef = expandPlatformEnum(fallback.merge.definition, input.candidate.instructions);
  const defWithName = (expandedDef as Record<string, unknown>).name !== undefined
    ? { ...(expandedDef as Record<string, unknown>), name: useName }
    : expandedDef;

  const merge: typeof fallback.merge = {
    name: useName,
    description: useDescription,
    definition: defWithName as object,
    instructions: useInstructions,
  };

  return {
    classification: 'PARTIAL_OVERLAP',
    confidence: input.fallbackConfidence ?? 0.3,
    reasoning: CLASSIFIER_FALLBACK_REASONING,
    proposedMerge: merge,
    mergeRationale: fallback.mergeRationale,
    classifierFallbackApplied: true,
  };
}

/** Returns true when the candidate description cross-references the library
 *  skill by name or slug in a "see X" / "use X" / "for X" context — a signal
 *  that the incoming skill treats the library skill as a separate, distinct
 *  tool rather than an extension of it. Used for DISTINCT_FALLBACK (v5 Fix 6). */
export function crossReferencesLibrarySkill(
  candidateDescription: string | null,
  libraryName: string,
  librarySlug: string,
): boolean {
  if (!candidateDescription) return false;
  const desc  = candidateDescription.toLowerCase();
  const lName = libraryName.toLowerCase();
  const lSlug = librarySlug.toLowerCase().replace(/_/g, '-');
  // Match "see X", "use X", "refer to X", or "for X" where X contains the library label
  const seeRe = /\b(see|use|refer to|for)\b(.{0,60})/g;
  let m: RegExpExecArray | null;
  while ((m = seeRe.exec(desc)) !== null) {
    const ctx = m[2];
    if (ctx.includes(lName) || ctx.includes(lSlug)) return true;
  }
  return false;
}

/** Merge two instruction bodies by (a) taking the dominant text as base and
 *  (b) appending any `## heading` sections from the secondary that the
 *  dominant doesn't already contain (case-insensitive heading match).
 *
 *  Invocation-block invariant (Issue A): if either source opens with an
 *  invocation trigger block, the merged output must also open with one. When
 *  the dominant lacks a block but the secondary has one, prepend it. This
 *  handles the common case where the incoming skill (richer, dominant) opens
 *  with a persona line ("You are an expert in…") while the library skill
 *  opens with "Invoke this skill when…" — the library's invocation block
 *  would otherwise be silently dropped by splitH2Sections. */
function mergeInstructionsRuleBased(
  dominant: string | null,
  secondary: string | null,
): string {
  const base = (dominant ?? '').trimEnd();
  if (!secondary || secondary.trim().length === 0) return base;

  // Collect existing H2 headings (normalized) in the dominant.
  const existingHeadings = new Set<string>();
  const h2Re = /^##\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = h2Re.exec(base)) !== null) existingHeadings.add(normaliseHeading(m[1]));

  // Split secondary into H2 sections and append any not already present.
  const sections = splitH2Sections(secondary);
  const appendParts: string[] = [];
  for (const section of sections) {
    const norm = normaliseHeading(section.heading);
    if (norm && !existingHeadings.has(norm)) {
      appendParts.push(section.body);
    }
  }
  let result = appendParts.length === 0 ? base : `${base}\n\n${appendParts.join('\n\n')}`.trim() + '\n';

  // Invocation-block invariant: if the secondary had a block but the dominant
  // didn't, prepend the secondary's block to the merged output.
  const dominantInvocation = extractInvocationBlock(dominant);
  const secondaryInvocation = extractInvocationBlock(secondary);
  if (!dominantInvocation && secondaryInvocation) {
    const mergedBlock = extractInvocationBlock(result);
    const isAtTop = mergedBlock !== null && result.trimStart().startsWith(mergedBlock.trimStart());
    if (!isAtTop) {
      const separator = startsWithPersonaOpener(result) ? '\n\n---\n\n' : '\n\n';
      result = `${secondaryInvocation.trimEnd()}${separator}${result.trimStart()}`;
    }
  }

  return result.trim() + '\n';
}

function normaliseHeading(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function splitH2Sections(text: string): Array<{ heading: string; body: string }> {
  const lines = text.split('\n');
  const sections: Array<{ heading: string; body: string }> = [];
  let currentHeading = '';
  let buf: string[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    sections.push({
      heading: currentHeading,
      body: `${currentHeading ? `## ${currentHeading}\n` : ''}${buf.join('\n').trimEnd()}`,
    });
    buf = [];
  };
  for (const line of lines) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      flush();
      currentHeading = h[1];
    } else {
      buf.push(line);
    }
  }
  flush();
  // Drop the implicit "preface" section with empty heading — we only want to
  // append real headings from the secondary.
  return sections.filter(s => s.heading.length > 0);
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
  // Only skip detection when the definition is a real Anthropic tool schema
  // (requires input_schema). The parser's extractJsonBlock is greedy and picks
  // up any JSON object in the body (config blocks, metadata, index entries),
  // so definition !== null alone is not a reliable signal of an executable skill.
  const hasRealDefinition =
    skill.definition !== null &&
    typeof (skill.definition as Record<string, unknown>).input_schema !== 'undefined';

  if (hasRealDefinition) {
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

// ---------------------------------------------------------------------------
// Fix 4 helpers — source retention scoring (v4 brief)
// ---------------------------------------------------------------------------

/** Word-overlap ratio: what fraction of the source's significant words
 *  (length > 3) appear somewhere in the merged text. */
export function wordOverlapRatio(source: string | null, merged: string | null): number {
  if (!source || !merged) return source ? 0 : 1;
  const sourceWords = new Set(
    source.toLowerCase().split(/\s+/).filter(w => w.length > 3),
  );
  if (sourceWords.size === 0) return 1;
  const mergedLower = merged.toLowerCase();
  let matches = 0;
  for (const word of sourceWords) {
    if (mergedLower.includes(word)) matches++;
  }
  return matches / sourceWords.size;
}

function computeDefinitionRetention(
  base: { definition: object | null },
  merged: ProposedMerge,
): number {
  const baseReq = ((base.definition as Record<string, unknown> | null)?.input_schema as Record<string, unknown> | undefined)?.required;
  const mergedReq = ((merged.definition as Record<string, unknown> | null)?.input_schema as Record<string, unknown> | undefined)?.required;
  const baseArr = Array.isArray(baseReq) ? (baseReq as string[]) : [];
  const mergedArr = Array.isArray(mergedReq) ? (mergedReq as string[]) : [];
  if (baseArr.length === 0) return 1;
  return baseArr.filter(f => mergedArr.includes(f)).length / baseArr.length;
}

function computeTableRetention(
  sourceLookup: Map<string, number>,
  mergedByHeader: Map<string, number>,
): number {
  if (sourceLookup.size === 0) return 1;
  let total = 0;
  for (const [header, sourceRows] of sourceLookup) {
    const mergedRows = mergedByHeader.get(header) ?? 0;
    total += sourceRows > 0 ? Math.min(1, mergedRows / sourceRows) : 1;
  }
  return total / sourceLookup.size;
}

function computeSourceRetention(
  base: { definition: object | null; instructions: string | null },
  merged: ProposedMerge,
  sourceLookup: Map<string, number>,
  mergedByHeader: Map<string, number>,
): number {
  const defRet   = computeDefinitionRetention(base, merged);
  const tblRet   = computeTableRetention(sourceLookup, mergedByHeader);
  const instrRet = wordOverlapRatio(base.instructions, merged.instructions);
  return defRet * 0.3 + tblRet * 0.3 + instrRet * 0.4;
}

// ---------------------------------------------------------------------------
// Fix 2 — table drop recovery appendix (v4 brief)
// Fix 3 (v5) — suppress reference appendix when merged output already covers data
// ---------------------------------------------------------------------------

/** Returns true if the merged output already contains table data that covers
 *  at least 70% of the source table's non-header cell values. Used to prevent
 *  duplicate reference appendices when the LLM restructured the table inline. */
function mergedOutputCoversTableData(
  sourceTable: ExtractedTableRows,
  mergedInstructions: string,
  coverageThreshold = 0.70,
): boolean {
  const sourceCells = sourceTable.rows.flatMap(row =>
    row.split('|')
      .map(c => c.replace(/\[SOURCE:[^\]]*\]/g, '').trim().toLowerCase())
      .filter(c => c.length > 1 && !/^-+$/.test(c)),
  );
  if (sourceCells.length === 0) return false;

  const mergedCells = new Set<string>(
    extractTablesWithRows(mergedInstructions).flatMap(t =>
      t.rows.flatMap(row =>
        row.split('|').map(c => c.trim().toLowerCase()).filter(c => c.length > 1),
      ),
    ),
  );

  const covered = sourceCells.filter(c => mergedCells.has(c)).length;
  return covered / sourceCells.length >= coverageThreshold;
}

/** When TABLE_ROWS_DROPPED warnings fire for tables with < 50% rows retained,
 *  append the original source table as a clearly-labelled reference appendix
 *  at the end of the merged instructions (before any Related Skills section).
 *
 *  Domain-agnostic. Only tables with headerKey present in sourceTables and
 *  with mergedRows < sourceRows * 0.5 are recovered. Idempotent: tables
 *  already in the appendix (heading contains "Reference:") are skipped. */
export function recoverDroppedTableRows(
  mergedInstructions: string,
  baseInstructions: string | null,
  nonBaseInstructions: string | null,
): string {
  const baseTables   = extractTablesWithRows(baseInstructions);
  const nonBaseTables = extractTablesWithRows(nonBaseInstructions);
  const mergedTables = extractTablesWithRows(mergedInstructions);

  const mergedByHeader = new Map(mergedTables.map(t => [t.headerKey, t.rows.length]));

  // Collect the best source table per header (most rows wins).
  const sourceBest = new Map<string, ExtractedTableRows>();
  for (const t of [...baseTables, ...nonBaseTables]) {
    const existing = sourceBest.get(t.headerKey);
    if (!existing || t.rows.length > existing.rows.length) {
      sourceBest.set(t.headerKey, t);
    }
  }

  const appendixBlocks: string[] = [];
  for (const [headerKey, sourceTable] of sourceBest) {
    const mergedRows = mergedByHeader.get(headerKey) ?? 0;
    const sourceRows = sourceTable.rows.length;
    if (sourceRows === 0 || mergedRows >= sourceRows * 0.5) continue;
    // Skip tables whose heading already says "Reference:" to prevent recursion.
    if (/reference:/i.test(headerKey)) continue;
    // v5 Fix 3: skip if the merged output already contains a table that covers
    // ≥70% of this source table's cell values — appending would be duplicate.
    if (mergedOutputCoversTableData(sourceTable, mergedInstructions)) continue;

    const headingPart = headerKey.includes('>')
      ? headerKey.split('>')[0].replace(/\b\w/g, c => c.toUpperCase())
      : headerKey.replace(/\b\w/g, c => c.toUpperCase());
    const block = [
      `### Reference: ${headingPart} (preserved from source — ${sourceRows} rows)`,
      sourceTable.headerLine,
      sourceTable.separatorLine,
      // Strip any [SOURCE: ...] annotations from original rows.
      ...sourceTable.rows.map(r => stripSourceAnnotations(r)),
    ].join('\n');
    appendixBlocks.push(block);
  }

  if (appendixBlocks.length === 0) return mergedInstructions;

  // Insert before "## Related Skills" if present, otherwise append.
  const relatedIdx = mergedInstructions.search(/^##\s+related\s+skills\b/im);
  const appendix = '\n\n' + appendixBlocks.join('\n\n');
  if (relatedIdx !== -1) {
    return mergedInstructions.slice(0, relatedIdx).trimEnd() + appendix + '\n\n' + mergedInstructions.slice(relatedIdx);
  }
  return mergedInstructions.trimEnd() + appendix + '\n';
}

// ---------------------------------------------------------------------------
// Fix 6 — persona opener detection (v4 brief)
// ---------------------------------------------------------------------------

/** Pattern for persona opener lines ("You are an expert…", "Your goal is…").
 *  Distinct from invocation triggers so the merger can order them correctly. */
const PERSONA_OPENER_RE =
  /^\s*(You\s+are\s+(an?\s+)?|Your\s+goal\s+is\s+(to\s+)?|You\s+speciali[sz]e\s+in\b|Act\s+as\s+(an?\s+)?)/i;

/** Returns true if the text opens with a persona statement rather than an
 *  invocation trigger. */
export function startsWithPersonaOpener(text: string | null): boolean {
  if (!text) return false;
  return PERSONA_OPENER_RE.test(text.trimStart());
}

// ---------------------------------------------------------------------------
// Fix 7 — output format block recovery (v4 brief)
// ---------------------------------------------------------------------------

const OUTPUT_FORMAT_SECTION_RE =
  /^#{1,4}\s+(output\s+format|response\s+format|output\s+template|format)\b/im;

/** Extract the output format section from instructions, including everything
 *  from the section heading to the next same-or-higher level heading. */
export function extractOutputFormatSection(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(OUTPUT_FORMAT_SECTION_RE);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  // Find the end: next heading at the same or higher level.
  const headingLevel = match[0].match(/^#+/)![0].length;
  const afterHeading = text.slice(start + match[0].length);
  const nextHeadingRe = new RegExp(`^#{1,${headingLevel}}\\s+`, 'm');
  const nextMatch = afterHeading.match(nextHeadingRe);
  const end = nextMatch?.index !== undefined
    ? start + match[0].length + nextMatch.index
    : text.length;
  return text.slice(start, end).trim();
}

/** When the merged output lacks an output format block but a source has one,
 *  append the source's format section at the end (before Related Skills). */
export function recoverOutputFormat(
  mergedInstructions: string,
  baseInstructions: string | null,
  nonBaseInstructions: string | null,
): string {
  if (hasOutputFormatBlock(mergedInstructions)) return mergedInstructions;
  const sourceBlock =
    extractOutputFormatSection(baseInstructions) ??
    extractOutputFormatSection(nonBaseInstructions);
  if (!sourceBlock) return mergedInstructions;

  const preserved =
    '### Output Format (preserved from source)\n\n' + sourceBlock.replace(/^#{1,4}\s+[^\n]+\n+/, '');

  const relatedIdx = mergedInstructions.search(/^##\s+related\s+skills\b/im);
  if (relatedIdx !== -1) {
    return mergedInstructions.slice(0, relatedIdx).trimEnd() + '\n\n' + preserved + '\n\n' + mergedInstructions.slice(relatedIdx);
  }
  return mergedInstructions.trimEnd() + '\n\n' + preserved + '\n';
}

// ---------------------------------------------------------------------------
// Fix 8 — content overlap detection across in-batch merges (v4 brief)
// ---------------------------------------------------------------------------

/** Extract H3+ section headings and their content from instructions. */
function extractH3Sections(text: string | null): Array<{ heading: string; body: string }> {
  if (!text) return [];
  const lines = text.split('\n');
  const sections: Array<{ heading: string; body: string }> = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const line of lines) {
    const h = line.match(/^#{3,}\s+(.+?)\s*$/);
    if (h) {
      if (current) sections.push({ heading: current.heading, body: current.lines.join('\n').trim() });
      current = { heading: h[1].toLowerCase().trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ heading: current.heading, body: current.lines.join('\n').trim() });
  return sections;
}

export interface ContentOverlapResult {
  candidateSlugA: string;
  candidateSlugB: string;
  overlappingHeading: string;
  similarityPct: number;
}

/** Detect when two in-batch merged skills share an H3+ section heading with
 *  similar content (> `threshold` word-overlap ratio). Returns findings for
 *  all pairs above the threshold. */
export function detectContentOverlap(
  skills: ReadonlyArray<{ slug: string; instructions: string | null }>,
  threshold = 0.70,
): ContentOverlapResult[] {
  const results: ContentOverlapResult[] = [];
  for (let i = 0; i < skills.length; i++) {
    const sectionsA = extractH3Sections(skills[i].instructions);
    for (let j = i + 1; j < skills.length; j++) {
      const sectionsB = extractH3Sections(skills[j].instructions);
      for (const sa of sectionsA) {
        const sb = sectionsB.find(s => s.heading === sa.heading);
        if (!sb || !sa.body || !sb.body) continue;
        const ratio = wordOverlapRatio(sa.body, sb.body);
        if (ratio >= threshold) {
          results.push({
            candidateSlugA: skills[i].slug,
            candidateSlugB: skills[j].slug,
            overlappingHeading: sa.heading,
            similarityPct: Math.round(ratio * 100),
          });
        }
      }
    }
  }
  return results;
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
  crossReferencesLibrarySkill,
  AGENT_RECOMMENDATION_THRESHOLD,
  AGENT_RECOMMENDATION_MIN_SKILLS,
};
