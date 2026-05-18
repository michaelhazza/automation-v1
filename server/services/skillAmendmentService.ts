// ---------------------------------------------------------------------------
// skillAmendmentService — Chunk 4 scope: validateAmendmentBody only.
// Lifecycle functions (accept, reject, retire, etc.) land in Chunk 5.
// Closed-Loop Skill Improvement spec §7.1, §9.1 step 8 (Chunk 4).
// ---------------------------------------------------------------------------

import type { AmendmentKind } from '../../shared/types/skillAmendments.js';

const IMPERATIVE_MODAL_PATTERN = /\b(must|should|never|always|do not|don['']t|do)\b/i;

const KIND_CEILINGS: Record<AmendmentKind, number> = {
  instruction_extension: 800,
  example: 1500,
  guardrail: 400,
  context_fact: 300,
  exception: 600,
};

const EVALUATOR_TARGETS = ['scorecard_judge_prompt', 'rca_proposer_prompt', 'peer_review_prompt'];

/**
 * Validate an amendment body against per-kind rules.
 *
 * Rules:
 * - Body must not exceed the KIND_CEILINGS[kind] character limit.
 * - For context_fact: body must not contain imperative-modal language.
 * - For any kind: body must not reference evaluator-surface target strings
 *   (anti-recursion guard per §6.2 / §8.2).
 */
export function validateAmendmentBody(
  kind: AmendmentKind,
  body: string,
): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  const ceiling = KIND_CEILINGS[kind];
  if (body.length > ceiling) {
    errors.push(`body exceeds ${ceiling}-character limit for kind '${kind}' (got ${body.length})`);
  }

  if (kind === 'context_fact' && IMPERATIVE_MODAL_PATTERN.test(body)) {
    errors.push("context_fact body must use declarative language only — imperative modal words (must, should, never, always, do not, don't, do) are not allowed");
  }

  for (const target of EVALUATOR_TARGETS) {
    if (body.includes(target)) {
      errors.push(`body must not reference evaluator surface '${target}' (anti-recursion rule)`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true };
}
