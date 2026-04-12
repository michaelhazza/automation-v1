/**
 * Decision envelope renderer for `agent_decision` steps.
 *
 * Spec: docs/playbook-agent-decision-step-spec.md §17.
 *
 * The envelope is the system prompt addendum appended to the agent's
 * normal system prompt when it is dispatched to make a playbook decision.
 * It is a TypeScript string constant — not a separate markdown file —
 * so that it is versioned, typechecked, and importable without filesystem I/O.
 *
 * This module is intentionally pure: no DB, no network, no env, no side effects.
 * `renderAgentDecisionEnvelope()` is deterministic — same input → same output.
 * This is what makes replay mode cheap (the envelope is reconstructed on replay).
 *
 * Whitelisted placeholders (spec §17.1):
 *   {{DECISION_PROMPT}}      — the author-supplied question, already templated
 *   {{BRANCHES_TABLE}}       — rendered branch list from renderBranchesTable()
 *   {{MIN_CONFIDENCE_CLAUSE}} — optional confidence threshold instruction
 *   {{RETRY_ERROR_BLOCK}}    — optional prior-attempt failure feedback
 *
 * Security note (spec §22.3): the decision prompt is escaped to prevent
 * markdown-breaking. The retry rawOutput is wrapped in a fenced code block
 * so it is treated as literal text, not as instructions.
 */

import type { AgentDecisionBranch } from './types.js';
import { renderBranchesTable } from './agentDecisionPure.js';

export interface EnvelopeRenderContext {
  /**
   * The decision question — already resolved via templating.ts against the
   * run context before being passed here. This module does not call the
   * templating resolver; it only escapes.
   */
  decisionPrompt: string;
  branches: AgentDecisionBranch[];
  /** Optional minimum confidence threshold in [0, 1]. */
  minConfidence?: number;
  /** Populated on retry attempts only. Absent on first attempt. */
  priorAttempt?: {
    /** Human-readable description of why the prior output failed. */
    errorMessage: string;
    /**
     * Raw prior output — should already be truncated to
     * DECISION_RETRY_RAW_OUTPUT_TRUNCATE_CHARS before being passed here.
     */
    rawOutput: string;
  };
}

/**
 * Pure, deterministic envelope renderer.
 * No DB, no LLM, no filesystem reads, no side effects.
 *
 * Given the same context, always produces the same string.
 */
export function renderAgentDecisionEnvelope(ctx: EnvelopeRenderContext): string {
  const branchesTable = renderBranchesTable(ctx.branches);
  const minConfidenceClause = buildMinConfidenceClause(ctx.minConfidence);
  const retryErrorBlock = buildRetryErrorBlock(ctx.priorAttempt);

  const parts: string[] = [
    '## Decision Required',
    '',
    'You are being asked to select one of a fixed set of predeclared branches in a playbook workflow. Your job is to read the context that preceded this step, pick the single most appropriate branch, and explain your reasoning.',
    '',
    'You do not have tools available in this step. You cannot take actions, call functions, or read external sources. Make the decision using only the information already provided in this conversation.',
    '',
    '### The question',
    '',
    escapeDecisionPrompt(ctx.decisionPrompt),
    '',
    '### Available branches',
    '',
    'You must pick exactly one of the following. Use the branch `id` as written — do not rename, reformat, or abbreviate.',
    '',
    branchesTable,
    '',
    '### Your response',
    '',
    'Respond with a single JSON object matching exactly this schema, and nothing else. Do not add prose before or after the JSON. Do not wrap it in a code block.',
    '',
    '```json',
    '{',
    '  "chosenBranchId": "<one of the branch ids above>",',
    '  "rationale": "<one to three sentences explaining your choice, referencing specific evidence from the context>",',
    '  "confidence": <number between 0 and 1>',
    '}',
    '```',
    '',
    '### Constraints on your response',
    '',
    '- `chosenBranchId` must be one of the ids shown above — no new branches, no combinations.',
    '- `rationale` must reference specific evidence from the prior steps or the question above. Generic reasoning is not acceptable.',
    '- `confidence` must be a number in [0, 1]. Use 1.0 only when the evidence is overwhelming; use 0.5 or below when the evidence is mixed or ambiguous.',
    '- You must pick a branch even if none feels perfect. If the evidence is too weak to justify any branch with reasonable confidence, set `confidence` below the threshold below and explain why in the `rationale` — the system will escalate to a human.',
  ];

  if (minConfidenceClause) {
    parts.push('', minConfidenceClause);
  }

  if (retryErrorBlock) {
    parts.push('', retryErrorBlock);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the optional MIN_CONFIDENCE_CLAUSE section.
 * Omitted entirely when minConfidence is not set.
 */
function buildMinConfidenceClause(minConfidence: number | undefined): string {
  if (minConfidence === undefined) return '';
  return [
    '### Confidence threshold',
    '',
    `The confidence threshold for this decision is ${minConfidence}. If your confidence is below ${minConfidence}, the system will pause and ask a human to confirm or override your choice. Do not artificially inflate your confidence to avoid escalation — low confidence is a valid signal and the right thing to do when the evidence is weak.`,
  ].join('\n');
}

/**
 * Build the optional RETRY_ERROR_BLOCK section.
 * Omitted entirely on the first attempt (priorAttempt is undefined).
 * The rawOutput is inserted inside a fenced code block so the model sees it
 * as literal text, not as instructions (spec §22.3).
 */
function buildRetryErrorBlock(
  priorAttempt: EnvelopeRenderContext['priorAttempt'],
): string {
  if (!priorAttempt) return '';
  return [
    '### Your previous response failed validation',
    '',
    'Your previous response failed validation for this reason:',
    '',
    `> ${priorAttempt.errorMessage}`,
    '',
    'Your previous response was:',
    '',
    '```',
    priorAttempt.rawOutput,
    '```',
    '',
    'Please fix the issue and respond again. Do not repeat the same mistake.',
  ].join('\n');
}

/**
 * Escape the decision prompt to prevent markdown-breaking content from
 * disrupting the envelope structure. This is not a full sanitiser — authors
 * are trusted (spec §22.2) — but it prevents accidental formatting issues.
 *
 * Spec §22.3: replace triple-backticks and strip embedded ## headings.
 */
function escapeDecisionPrompt(prompt: string): string {
  return prompt
    .replace(/```/g, '``\u200b`') // zero-width space between backticks
    .replace(/^## /gm, '\\## '); // escape level-2 headings at line start
}
