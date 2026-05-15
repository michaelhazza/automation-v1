import { diffWordsWithSpace } from 'diff';
import { ParsedSkill, contentHash } from './skillParserServicePure.js';
import { type LibrarySkillSummary, type ClassificationResult, type SimilarityBand, cosineSimilarity, classifyBand, computeBestMatches, isValidClassification } from './skillAnalyzerServicePure/similarity.js';
import { canonicalJSON } from './skillAnalyzerServicePure/serialisation.js';
import { crossReferencesLibrarySkill } from './skillAnalyzerServicePure/crossRef.js';
import { buildClassificationPrompt, buildClassifyPromptWithMerge } from './skillAnalyzerServicePure/classification/prompts.js';
import { parseClassificationResponse, parseClassificationResponseWithMerge } from './skillAnalyzerServicePure/classification/parse.js';
import { deriveClassificationFailureReason } from './skillAnalyzerServicePure/classification/failureReason.js';
import type { ProposedMerge, MergeWarning, MergeWarningCode, WarningTier } from './skillAnalyzerServicePure/mergeWarnings/types.js';
import { DEFAULT_WARNING_TIER_MAP } from './skillAnalyzerServicePure/mergeWarnings/defaults.js';
import { sortWarningsBySeverity } from './skillAnalyzerServicePure/mergeWarnings/sort.js';
import { classifyDemotedFields, parseDemotedFieldStatuses, adjustClassifierConfidence } from './skillAnalyzerServicePure/mergeWarnings/approval.js';
import { extractDescriptionBigrams, isGenericBigram, wordOverlapRatio, extractInvocationBlock } from './skillAnalyzerServicePure/textExtraction.js';
import { splitH2Sections, rationaleArguesAgainstMerge } from './skillAnalyzerServicePure/ruleBasedMerge.js';

// ---------------------------------------------------------------------------
// Skill Analyzer Service — Pure Functions
// Zero DB/env/service imports. Fully testable in isolation.
// ---------------------------------------------------------------------------

// --- Transitional re-exports (removed when barrel is rewritten in Chunk 6) ---
export { SKILL_ANALYZER_MID_FLIGHT_STATUSES, SKILL_ANALYZER_TERMINAL_STATUSES, SKILL_ANALYZER_JOB_STATUSES, type SkillAnalyzerMidFlightStatus, type SkillAnalyzerTerminalStatus, type SkillAnalyzerJobStatus, isSkillAnalyzerTerminalStatus, isSkillAnalyzerMidFlightStatus } from './skillAnalyzerServicePure/statuses.js';
export { type LibrarySkillSummary, type ClassificationResult, type SimilarityBand, cosineSimilarity, classifyBand, computeBestMatches } from './skillAnalyzerServicePure/similarity.js';
export { canonicalJSON, sortKeys } from './skillAnalyzerServicePure/serialisation.js';
export { crossReferencesLibrarySkill } from './skillAnalyzerServicePure/crossRef.js';
export { CLASSIFICATION_SYSTEM_PROMPT, formatSkillForPrompt, buildClassificationPrompt, buildClassifyPromptWithMerge, CLASSIFICATION_WITH_MERGE_SYSTEM_PROMPT } from './skillAnalyzerServicePure/classification/prompts.js';
export { parseClassificationResponse, type ClassificationResultWithMerge, parseClassificationResponseWithMerge } from './skillAnalyzerServicePure/classification/parse.js';
export { deriveClassificationFailureReason } from './skillAnalyzerServicePure/classification/failureReason.js';
export * from './skillAnalyzerServicePure/mergeWarnings/types.js';
export * from './skillAnalyzerServicePure/mergeWarnings/defaults.js';
export * from './skillAnalyzerServicePure/mergeWarnings/sort.js';
export * from './skillAnalyzerServicePure/mergeWarnings/resolutions.js';
export * from './skillAnalyzerServicePure/mergeWarnings/approval.js';
export * from './skillAnalyzerServicePure/concurrency.js';
export * from './skillAnalyzerServicePure/validation.js';
export * from './skillAnalyzerServicePure/ruleBasedMerge.js';
export * from './skillAnalyzerServicePure/textExtraction.js';

// ---------------------------------------------------------------------------
// Merge Validation Helpers
// ---------------------------------------------------------------------------

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
// Pure wrapper around jsdiff's diffWordsWithSpace so the diff algorithm
// is testable in isolation.

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

// ---------------------------------------------------------------------------
// Consolidation-pass pure functions (Chunk 2)
// ---------------------------------------------------------------------------

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

  // Tier 2: bare snake_case / kebab-case identifiers (≥4 chars, contains _ or -)
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
  rationaleArguesAgainstMerge,
  classifyDemotedFields,
  parseDemotedFieldStatuses,
  adjustClassifierConfidence,
  AGENT_RECOMMENDATION_THRESHOLD,
  AGENT_RECOMMENDATION_MIN_SKILLS,
  extractPreservationInventory,
  buildConsolidationPrompt,
  parseConsolidationResponse,
  computeConsolidationViolations,
};
