// ---------------------------------------------------------------------------
// skillAmendmentServiceStateMachinePure — pure state-machine transition guard.
// Closed-Loop Skill Improvement spec §18.6 (Chunk 5).
// ---------------------------------------------------------------------------

import type { AmendmentStatus, RetirementReason } from '../../shared/types/skillAmendments.js';

export type AmendmentTransition =
  | { from: 'draft'; to: 'pending_review' }
  | { from: 'pending_review'; to: 'accepted' }
  | { from: 'pending_review'; to: 'rejected' }
  | { from: 'pending_review'; to: 'retired'; reason: 'stale' | 'superseded' }
  | { from: 'accepted'; to: 'retired'; reason: 'graceful' | 'rollback' | 'stale' | 'superseded' | 'baseline_reset' };

const VALID_RETIRE_REASONS_FROM_PENDING_REVIEW: ReadonlySet<RetirementReason> = new Set(['stale', 'superseded']);
const VALID_RETIRE_REASONS_FROM_ACCEPTED: ReadonlySet<RetirementReason> = new Set(['graceful', 'rollback', 'stale', 'superseded', 'baseline_reset']);

/**
 * Assert that a status transition is valid per spec §18.6.
 *
 * Throws a plain object with statusCode 422 on any forbidden transition.
 * Terminal states (rejected, retired) always throw.
 */
export function assertValidAmendmentTransition(t: {
  from: AmendmentStatus;
  to: AmendmentStatus;
  reason?: RetirementReason;
}): void {
  const { from, to, reason } = t;

  // Terminal states — no outgoing transitions.
  if (from === 'rejected' || from === 'retired') {
    throw { statusCode: 422, message: 'invalid_amendment_transition', errorCode: 'invalid_transition' };
  }

  if (from === 'draft') {
    // draft → pending_review only; draft → accepted is forbidden (§18.1 / §18.6).
    if (to === 'pending_review') return;
    throw { statusCode: 422, message: 'invalid_amendment_transition', errorCode: 'invalid_transition' };
  }

  if (from === 'pending_review') {
    if (to === 'accepted') return;
    if (to === 'rejected') return;
    if (to === 'retired') {
      if (!reason || !VALID_RETIRE_REASONS_FROM_PENDING_REVIEW.has(reason)) {
        throw { statusCode: 422, message: 'invalid_amendment_transition', errorCode: 'invalid_transition' };
      }
      return;
    }
    // pending_review → draft or any other is forbidden.
    throw { statusCode: 422, message: 'invalid_amendment_transition', errorCode: 'invalid_transition' };
  }

  if (from === 'accepted') {
    // accepted → rejected is explicitly forbidden per spec §18.6.
    if (to === 'rejected') {
      throw { statusCode: 422, message: 'invalid_amendment_transition', errorCode: 'invalid_transition' };
    }
    if (to === 'retired') {
      if (!reason || !VALID_RETIRE_REASONS_FROM_ACCEPTED.has(reason)) {
        throw { statusCode: 422, message: 'invalid_amendment_transition', errorCode: 'invalid_transition' };
      }
      return;
    }
    throw { statusCode: 422, message: 'invalid_amendment_transition', errorCode: 'invalid_transition' };
  }

  // Fallthrough — unknown from state.
  throw { statusCode: 422, message: 'invalid_amendment_transition', errorCode: 'invalid_transition' };
}
