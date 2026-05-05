// ---------------------------------------------------------------------------
// workflowEngineServicePure — pure helpers for workflow engine logic
//
// No DB, no I/O. All functions are deterministic and side-effect-free.
// Spec: tasks/builds/agentic-commerce/spec.md §7.3, plan §Chunk 10.
// ---------------------------------------------------------------------------

import { SPEND_ACTION_ALLOWED_SLUGS } from '../config/actionRegistry.js';

/**
 * All known reviewKind values for workflow step approval pauses.
 * Extend when adding new approval categories.
 * Spec §7.3 — 'spend_approval' added for Agentic Commerce (Chunk 10).
 */
export type ReviewKind =
  | 'supervised_mode'
  | 'invoke_automation_gate'
  | 'decision_confidence_escalation'
  | 'action_call_approval'
  | 'spend_approval';

/**
 * Minimal shape of a resume token's discriminating fields.
 * The full token is impure (carries actionId, stepRunId, etc.);
 * this pure helper only cares about the kind label.
 */
export interface ResumeToken {
  reviewKind: string;
}

/**
 * Minimal shape of the action metadata stored on the action row.
 * Only the fields relevant to kind validation are required here.
 */
export interface ActionCallMetadata {
  /** The action slug that was proposed. */
  actionSlug?: string;
}

export type ValidateResumeKindResult =
  | { valid: true }
  | { valid: false; code: 'review_kind_mismatch'; expected: string; got: string };

/**
 * Validates that a resume token's `reviewKind` is consistent with the
 * action's slug. Specifically: a token claiming `reviewKind = 'spend_approval'`
 * must correspond to a spend-enabled action slug; any other token paired with
 * a spend slug must claim `reviewKind = 'spend_approval'`.
 *
 * This is a defensive guard (spec §Chunk 10). In normal flow the pausing
 * code always emits the correct kind; this guard detects bugs or
 * tampered resume payloads.
 *
 * Returns `{ valid: true }` when the token is consistent.
 * Returns `{ valid: false, code: 'review_kind_mismatch', ... }` otherwise.
 */
export function validateResumeKind(
  token: ResumeToken,
  meta: ActionCallMetadata,
): ValidateResumeKindResult {
  const slug = meta.actionSlug ?? '';
  const isSpendSlug = (SPEND_ACTION_ALLOWED_SLUGS as readonly string[]).includes(slug);
  const isSpendKind = token.reviewKind === 'spend_approval';

  if (isSpendKind && !isSpendSlug) {
    return {
      valid: false,
      code: 'review_kind_mismatch',
      expected: 'action_call_approval',
      got: token.reviewKind,
    };
  }
  if (isSpendSlug && !isSpendKind) {
    return {
      valid: false,
      code: 'review_kind_mismatch',
      expected: 'spend_approval',
      got: token.reviewKind,
    };
  }
  return { valid: true };
}
