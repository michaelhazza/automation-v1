/**
 * reviewServicePure.ts — Pure idempotency decision helpers for reviewService.
 *
 * No DB, no network, no side effects.
 *
 * Per spec §6.2.1 (clientpulse-ui-simplification), approve/reject must be
 * idempotent at the terminal-state level:
 *
 *   - Requesting the SAME terminal state a second time → 'idempotent' (200)
 *   - Requesting the OPPOSITE terminal state → 'conflict' (409 ITEM_CONFLICT)
 *   - Item is still pending/edited_pending → 'proceed'
 *   - Item not found (undefined status) → 'not_found'
 */

export type ReviewStatus =
  | 'pending'
  | 'edited_pending'
  | 'approved'
  | 'rejected'
  | 'completed';

export type RequestedAction = 'approve' | 'reject';

/**
 * The outcome of an idempotency check.
 *
 *   proceed    — item is still pending; caller should run the full transition.
 *   idempotent — item is already in the requested terminal state; caller
 *                should return the existing row as-is with HTTP 200.
 *   conflict   — item reached a different terminal state; caller should
 *                throw 409 ITEM_CONFLICT.
 *   not_found  — item does not exist in the organisation scope.
 */
export type IdempotencyOutcome = 'proceed' | 'idempotent' | 'conflict' | 'not_found';

/**
 * Determine the idempotency outcome for an approve or reject request.
 *
 * @param currentStatus  The `reviewStatus` of the existing row (or `undefined`
 *                       when the row is absent).
 * @param action         The caller's requested action: 'approve' or 'reject'.
 */
export function checkIdempotency(
  currentStatus: ReviewStatus | undefined,
  action: RequestedAction,
): IdempotencyOutcome {
  if (currentStatus === undefined) {
    return 'not_found';
  }

  if (currentStatus === 'pending' || currentStatus === 'edited_pending') {
    return 'proceed';
  }

  // Item has reached a terminal state.
  if (action === 'approve') {
    if (currentStatus === 'approved' || currentStatus === 'completed') {
      return 'idempotent';
    }
    // currentStatus is 'rejected'
    return 'conflict';
  }

  // action === 'reject'
  if (currentStatus === 'rejected') {
    return 'idempotent';
  }
  // currentStatus is 'approved' or 'completed'
  return 'conflict';
}
