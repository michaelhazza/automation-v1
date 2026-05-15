// ---------------------------------------------------------------------------
// Agent ranking — Phase 2 of skill-analyzer-v2
// ---------------------------------------------------------------------------

import { diffWordsWithSpace } from 'diff';
import type { ParsedSkill } from '../skillParserServicePure.js';
import { cosineSimilarity } from './similarity.js';

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
