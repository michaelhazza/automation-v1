// Pure helpers for actionService — no DB, no IO.
// Cross-owner approver derivation and timeout-policy decision tree.
// Spec: tasks/builds/personal-assistant-v2-operator/plan.md §9 Chunk 4.

import { hashActionArgs } from '../lib/canonicalJsonPure.js';
import { IDEMPOTENCY_KEY_VERSION } from '../lib/idempotencyVersion.js';

// ---------------------------------------------------------------------------
// Idempotency key — pure computation (no DB dependency)
// ---------------------------------------------------------------------------

/**
 * Deterministic idempotency key for an action.
 * Pure: depends only on (runId, toolCallId, args) — no DB, no IO.
 *
 * See actionService.ts for the full retry-vs-replay contract note.
 */
export function buildActionIdempotencyKey(params: {
  runId: string;
  toolCallId: string;
  args: Record<string, unknown>;
}): string {
  const argsHash = hashActionArgs(params.args);
  return `${IDEMPOTENCY_KEY_VERSION}:${params.runId}:${params.toolCallId}:${argsHash}`;
}

// ---------------------------------------------------------------------------
// Approver gate predicate
// ---------------------------------------------------------------------------

/**
 * Returns true when the requesting user is NOT the designated approver.
 * A null/undefined approverUserId means "anyone may act" (V1 initiator-defaulted path).
 */
export function isWrongApprover(approverUserId: string | null | undefined, requestingUserId: string): boolean {
  if (approverUserId === null || approverUserId === undefined) return false;
  return approverUserId !== requestingUserId;
}

// ---------------------------------------------------------------------------
// Approver derivation
// ---------------------------------------------------------------------------

/**
 * Derive the approver for a proposed action.
 * Cross-owner proposals: executor agent's owner_user_id.
 * All other proposals: null (V1 initiator-defaulted behaviour preserved).
 */
export function deriveApproverUserId(opts: {
  isCrossOwner: boolean;
  executorOwnerUserId?: string | null;
}): string | null {
  if (!opts.isCrossOwner) return null;
  return opts.executorOwnerUserId ?? null;
}

// ---------------------------------------------------------------------------
// Approval-queue read predicate description
// ---------------------------------------------------------------------------

/**
 * Build the UNION read predicate description for listPendingApprovalsForUser.
 * Pure: describes the predicate logic; DB query is in actionService.ts.
 */
export function buildApproverReadPredicateDescription(userId: string): {
  explicitArmDescription: string;
  defaultArmDescription: string;
} {
  return {
    explicitArmDescription: `approver_user_id = ${userId} AND status = 'pending_approval'`,
    defaultArmDescription: `approver_user_id IS NULL AND status = 'pending_approval' (V1 initiator-defaulted path)`,
  };
}

// ---------------------------------------------------------------------------
// Timeout-policy decision tree
// ---------------------------------------------------------------------------

export type TimeoutPolicyDecision =
  | { action: 'fail_parent'; eventStatus: 'failed'; eventReason: 'cross_owner_approval_timeout' }
  | { action: 'continue_without_substep'; eventStatus: 'partial'; eventReason: 'cross_owner_approval_timed_out_optional' }
  | { action: 'ask_initiator' };

/**
 * Decide the cross-owner substep terminal outcome from the timeout policy.
 * Returns a structured decision for the stall job to act on.
 */
export function decideTimeoutPolicyAction(
  policy: 'fail_parent' | 'continue_without_substep' | 'ask_initiator',
): TimeoutPolicyDecision {
  switch (policy) {
    case 'fail_parent':
      return { action: 'fail_parent', eventStatus: 'failed', eventReason: 'cross_owner_approval_timeout' };
    case 'continue_without_substep':
      return { action: 'continue_without_substep', eventStatus: 'partial', eventReason: 'cross_owner_approval_timed_out_optional' };
    case 'ask_initiator':
      return { action: 'ask_initiator' };
  }
}
