// ---------------------------------------------------------------------------
// Rule-based fallback merger — v2 Fix 1 + classification-failure outcome
// ---------------------------------------------------------------------------

import type { ProposedMerge, MergeWarning } from './mergeWarnings/types.js';
import { richnessScore, extractInvocationBlock, startsWithPersonaOpener } from './textExtraction.js';

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
  const description = (candidate.description && library.description)
    ? (candidate.description.length <= library.description.length
      ? candidate.description
      : library.description)
    : (candidate.description || library.description || '');

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

/** Build the complete outcome returned whenever classification fails.
 *  Wraps `buildRuleBasedMerge` with standard reasoning copy, a low-confidence
 *  score (clamped to `fallbackConfidence`, default 0.3), and the
 *  `classifierFallbackApplied` flag. Validation (merge warnings) is applied
 *  separately by the caller — the job and retry paths each compose this
 *  outcome with their own validateMergeOutput / remediateTables plumbing. */
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

/** v7-B Fix #3a — detect when a classifier's own merge rationale argues
 *  against the merge it returned. The LLM frequently writes phrases like
 *  "neither fully replaces the other" or "produce different artifacts"
 *  inside a PARTIAL_OVERLAP / IMPROVEMENT rationale — that's the model
 *  contradicting its own classification. When this fires the caller flips
 *  the classification to DISTINCT (with a logged reasoning prefix).
 *
 *  Patterns kept conservative to avoid false positives on benign rationales
 *  that happen to use the words "different" or "replace" in passing. Each
 *  pattern requires the disqualifying intent (replacement-failure, artifact
 *  divergence, fundamental-purpose split) to be the rationale's own claim. */
const RATIONALE_CONTRADICTION_PATTERNS: RegExp[] = [
  // "neither fully replaces the other", "neither skill replaces the other"
  /\bneither\s+(fully\s+)?(skill\s+)?replaces?\s+the\s+other\b/i,
  // "produce different artifacts", "produces different artifact types"
  /\b(produce|produces|generate|generates|return|returns)\s+(\w+\s+)?(different|distinct)\s+(artifact|output|deliverable)s?\b/i,
  // "fundamentally different (purposes|artifacts|outputs|workflows|behaviours)"
  /\bfundamentally\s+different\s+(purpose|artifact|output|workflow|behaviou?r|use\s+case)s?\b/i,
  // "completely different (purposes|artifacts|outputs)"
  /\bcompletely\s+different\s+(purpose|artifact|output|workflow|use\s+case)s?\b/i,
  // "(differ|different) significantly in (scope|artifact|purpose) and"
  /\bdiffer(s|ed)?\s+significantly\s+in\s+\w+(\s+and\s+\w+)+\b/i,
];

/** Returns true if the LLM's reasoning text contains language that
 *  argues against its own merge — a strong signal the classification
 *  should have been DISTINCT. Used after the classifier returns
 *  PARTIAL_OVERLAP / IMPROVEMENT to flip clearly-self-contradicting
 *  rows to DISTINCT before persistence. */
export function rationaleArguesAgainstMerge(reasoning: string | null | undefined): boolean {
  if (!reasoning) return false;
  return RATIONALE_CONTRADICTION_PATTERNS.some(re => re.test(reasoning));
}

// ---------------------------------------------------------------------------
// Instruction merge helper
// ---------------------------------------------------------------------------

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

export function normaliseHeading(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function splitH2Sections(text: string): Array<{ heading: string; body: string }> {
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

