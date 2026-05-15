// ---------------------------------------------------------------------------
// Consolidation-pass pure functions
// ---------------------------------------------------------------------------

import type { ProposedMerge } from './mergeWarnings/types.js';
import { canonicalJSON } from './serialisation.js';
import { extractInvocationBlock } from './textExtraction.js';

export type ConsolidationOutcome = 'not_triggered' | 'succeeded' | 'declined' | 'failed';

export type PreservationInventoryItem = {
  kind: 'tool_ref' | 'hitl_phrase' | 'invocation_block';
  value: string;
};
export type PreservationInventory = PreservationInventoryItem[];

/** Tier-1 HITL phrases that must be preserved verbatim in any consolidation. */
const CONSOLIDATION_TIER1_HITL_PHRASES = [
  'do not send directly',
  'do not post without approval',
  'review before sending',
  'human approval required',
  'present to user for confirmation',
  'do not send without',
  'confirm before',
] as const;

/** Tier-2 (lower-confidence) HITL phrases used as best-effort preservation hints. */
const CONSOLIDATION_TIER2_HITL_PHRASES = [
  'requires human approval',
  'do not act without confirmation',
] as const;

/**
 * Extract a tiered preservation inventory from a ProposedMerge.
 * Tier 1: high-confidence preservation-critical items (tool refs, invocation
 * block, explicit HITL phrases). Tier 2: lower-confidence items (bare
 * snake_case/kebab-case identifiers, lower-confidence HITL phrases).
 * Pure: no DB, no network, no clock.
 */
export function extractPreservationInventory(
  merged: ProposedMerge,
): { tier1: PreservationInventory; tier2: PreservationInventory } {
  const instructions = merged.instructions ?? '';
  const tier1: PreservationInventory = [];
  const tier2: PreservationInventory = [];

  if (!instructions) {
    return { tier1, tier2 };
  }

  // Tier 1: every backtick-wrapped identifier
  const backtickRe = /`([^`\n]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = backtickRe.exec(instructions)) !== null) {
    tier1.push({ kind: 'tool_ref', value: m[1] });
  }

  // Tier 1: invocation block
  const invBlock = extractInvocationBlock(instructions);
  if (invBlock) {
    tier1.push({ kind: 'invocation_block', value: invBlock });
  }

  // Tier 1: HITL phrase matches (case-insensitive substring search)
  const lowerInstructions = instructions.toLowerCase();
  for (const phrase of CONSOLIDATION_TIER1_HITL_PHRASES) {
    if (lowerInstructions.includes(phrase)) {
      tier1.push({ kind: 'hitl_phrase', value: phrase });
    }
  }

  // Tier 2: bare snake_case / kebab-case identifiers (>=4 chars, contains _ or -)
  // NOT inside backticks, NOT inside markdown link text [...].
  // Strategy: collect ranges occupied by backtick spans and [...] link texts,
  // then only emit identifiers whose match start falls outside those ranges.
  const backtickRanges: Array<[number, number]> = [];
  const backtickScan = /`[^`\n]*`/g;
  let br: RegExpExecArray | null;
  while ((br = backtickScan.exec(instructions)) !== null) {
    backtickRanges.push([br.index, br.index + br[0].length]);
  }
  const linkTextRanges: Array<[number, number]> = [];
  const linkTextScan = /\[([^\]]*)\]/g;
  let lt: RegExpExecArray | null;
  while ((lt = linkTextScan.exec(instructions)) !== null) {
    linkTextRanges.push([lt.index, lt.index + lt[0].length]);
  }

  const identRe = /\b([a-z][a-z0-9]*[-_][a-z0-9][-_a-z0-9]*)\b/g;
  let ir: RegExpExecArray | null;
  while ((ir = identRe.exec(instructions)) !== null) {
    const pos = ir.index;
    const inBacktick = backtickRanges.some(([s, e]) => pos >= s && pos < e);
    const inLinkText = linkTextRanges.some(([s, e]) => pos >= s && pos < e);
    if (!inBacktick && !inLinkText) {
      tier2.push({ kind: 'tool_ref', value: ir[1] });
    }
  }

  // Tier 2: lower-confidence HITL phrases
  for (const phrase of CONSOLIDATION_TIER2_HITL_PHRASES) {
    if (lowerInstructions.includes(phrase)) {
      tier2.push({ kind: 'hitl_phrase', value: phrase });
    }
  }

  return { tier1, tier2 };
}

/**
 * Build the system + user prompts for the consolidation LLM pass.
 * Returns a shape matching buildClassifyPromptWithMerge.
 * Pure: no DB, no network, no clock.
 */
export function buildConsolidationPrompt(
  merged: ProposedMerge,
  richerSourceWords: number,
  mergedWords: number,
  scopeExpansionStandardThreshold: number,
): { system: string; userMessage: string } {
  const targetCeiling = Math.round(richerSourceWords * (1 + scopeExpansionStandardThreshold));
  const { tier1, tier2 } = extractPreservationInventory(merged);

  const tier1List = tier1.length > 0
    ? tier1.map(item => `  - [${item.kind}] ${item.value}`).join('\n')
    : '  (none detected)';
  const tier2List = tier2.length > 0
    ? tier2.map(item => `  - [${item.kind}] ${item.value}`).join('\n')
    : '  (none detected)';

  const system = `You consolidate skill-merge outputs for length without losing capability.

## Your task

You will receive a merged skill draft that is longer than the target ceiling. Your job is to shorten it while strictly preserving every capability-critical element listed in the PRESERVATION INVENTORY.

## Hard preservation rules (never violate)

- Every backtick-wrapped tool/skill reference must appear in the consolidated output unchanged.
- The invocation trigger block (the opening block stating when to invoke the skill) must remain at the top of the instructions, intact.
- Every explicit human-review-gate phrase (HITL phrases) must be preserved verbatim. Do not soften, paraphrase, or remove them.
- All required fields (name, description, definition structure) must remain unchanged.
- \`mergeRationale\` must be echoed back exactly as provided — do not modify it.

## Reduction target

Target ceiling: ${targetCeiling} words in the consolidated instructions.
Aim for this ceiling. Do not exceed it if it can be avoided without violating hard preservation rules.

## Self-check (required before returning)

Before writing your JSON response, verify:
1. No backtick-wrapped references have been removed.
2. The invocation trigger block (if present) is still at the top and intact.
3. No HITL phrases have been removed or softened.
4. All required fields are present and unchanged (name, description, definition, mergeRationale).
5. \`declinedToConsolidate\` is false only if the consolidated instructions are genuinely shorter than the input.

If you cannot shorten the instructions without violating a hard preservation rule, set \`declinedToConsolidate: true\` and explain in \`declineReason\`.

## Output format

Return strict JSON matching this exact shape:
\`\`\`json
{
  "consolidatedMerge": {
    "name": "<string — must equal the input name>",
    "description": "<string — must equal the input description>",
    "definition": <object — must deep-equal the input definition>,
    "instructions": "<string — the shortened instructions>",
    "mergeRationale": "<string — must equal the input mergeRationale exactly>"
  },
  "consolidationNote": "<string — one or two sentences explaining what was trimmed and why>",
  "declinedToConsolidate": <boolean>,
  "declineReason": "<string or null — required and non-empty when declinedToConsolidate is true>"
}
\`\`\`

Do not wrap the JSON in a code block. Return only the JSON object.`;

  // Build user message — serialize merged but note mergeRationale must be echoed back
  const mergedForPrompt = {
    name: merged.name,
    description: merged.description,
    definition: merged.definition,
    instructions: merged.instructions,
    mergeRationale: merged.mergeRationale,
  };

  const userMessage = `## MERGED SKILL (DRAFT)

${JSON.stringify(mergedForPrompt, null, 2)}

## PRESERVATION INVENTORY

### Tier 1 — verbatim preservation required
${tier1List}

### Tier 2 — best-effort preservation (informational)
${tier2List}

## Word counts

Pre-consolidation merged instructions: ${mergedWords} words
Richer source skill: ${richerSourceWords} words
Target ceiling: ${targetCeiling} words`;

  return { system, userMessage };
}

export type ConsolidationParseResult = {
  consolidatedMerge: ProposedMerge;
  consolidationNote: string;
  declinedToConsolidate: boolean;
  declineReason: string | null;
};

export type ConsolidationParseRejection = {
  reason:
    | 'mutated_name'
    | 'mutated_description'
    | 'mutated_definition'
    | 'rationale_missing_or_invalid'
    | 'mutated_rationale'
    | 'instructions_not_string'
    | 'instructions_empty'
    | 'note_missing_or_invalid'
    | 'declined_not_boolean'
    | 'decline_reason_missing'
    | 'malformed_json';
};

/**
 * Parse and validate the consolidation LLM response.
 * Never throws — all malformed inputs return a typed ConsolidationParseRejection.
 * Rejection rules are applied in a fixed order; the first matching rule wins.
 */
export function parseConsolidationResponse(
  raw: string,
  original: ProposedMerge,
): ConsolidationParseResult | ConsolidationParseRejection {
  // Strip code-fence wrappers (same tolerance as parseClassificationResponseWithMerge)
  let jsonStr = raw.trim();
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start !== -1 && end > start) {
    jsonStr = jsonStr.slice(start, end + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { reason: 'malformed_json' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { reason: 'malformed_json' };
  }

  const p = parsed as Record<string, unknown>;
  const cm = p.consolidatedMerge as Record<string, unknown> | undefined;

  if (!cm || typeof cm !== 'object') {
    return { reason: 'malformed_json' };
  }

  // Rule 2: name mutation
  if (cm.name !== original.name) {
    return { reason: 'mutated_name' };
  }

  // Rule 3: description mutation
  if (cm.description !== original.description) {
    return { reason: 'mutated_description' };
  }

  // Rule 4: definition deep-equal. Key order is not semantic, so canonicalise
  // both sides before comparison — LLMs commonly reorder JSON keys even when
  // the shape is equivalent, and rejecting on order would emit spurious
  // CONSOLIDATION_FAILED.
  if (canonicalJSON(cm.definition) !== canonicalJSON(original.definition)) {
    return { reason: 'mutated_definition' };
  }

  // Rule 5a: mergeRationale missing / null / non-string / whitespace-only
  if (
    typeof cm.mergeRationale !== 'string' ||
    (cm.mergeRationale as string).trim() === ''
  ) {
    return { reason: 'rationale_missing_or_invalid' };
  }

  // Rule 5b: mergeRationale mutation
  if (cm.mergeRationale !== original.mergeRationale) {
    return { reason: 'mutated_rationale' };
  }

  // Rule 6: instructions type
  if (typeof cm.instructions !== 'string') {
    return { reason: 'instructions_not_string' };
  }

  // Rule 7: instructions empty
  if ((cm.instructions as string).trim() === '') {
    return { reason: 'instructions_empty' };
  }

  // Rule 8: consolidationNote missing / non-string / whitespace-only
  if (
    typeof p.consolidationNote !== 'string' ||
    (p.consolidationNote as string).trim() === ''
  ) {
    return { reason: 'note_missing_or_invalid' };
  }

  // Rule 9: declinedToConsolidate must be boolean
  if (typeof p.declinedToConsolidate !== 'boolean') {
    return { reason: 'declined_not_boolean' };
  }

  // Rule 10: declinedToConsolidate=true requires non-empty declineReason
  if (
    p.declinedToConsolidate === true &&
    (p.declineReason == null ||
      typeof p.declineReason !== 'string' ||
      (p.declineReason as string).trim() === '')
  ) {
    return { reason: 'decline_reason_missing' };
  }

  const consolidatedMerge: ProposedMerge = {
    name: cm.name as string,
    description: cm.description as string,
    definition: cm.definition as object,
    instructions: cm.instructions as string,
    mergeRationale: cm.mergeRationale as string,
  };

  return {
    consolidatedMerge,
    consolidationNote: p.consolidationNote as string,
    declinedToConsolidate: p.declinedToConsolidate as boolean,
    declineReason: p.declinedToConsolidate
      ? (p.declineReason as string)
      : null,
  };
}

/**
 * Compute the set of hard-constraint violation codes introduced by
 * post-consolidation warnings that were NOT present before consolidation.
 * Returns an empty array when consolidation may proceed (succeeded path).
 * Pure: no DB, no network.
 */
export function computeConsolidationViolations(
  preWarnings: readonly { code: string }[],
  postWarnings: readonly { code: string }[],
): string[] {
  const HARD = new Set(['HITL_LOST', 'INVOCATION_LOST', 'REQUIRED_FIELD_DEMOTED', 'CAPABILITY_OVERLAP']);
  const preHard = new Set(preWarnings.filter(w => HARD.has(w.code)).map(w => w.code));
  const postHard = new Set(postWarnings.filter(w => HARD.has(w.code)).map(w => w.code));
  return [...postHard].filter(c => !preHard.has(c));
}
