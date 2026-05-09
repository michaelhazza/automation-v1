// supportDraftDispatchServicePure.ts — Pure helpers for the support draft dispatch path.
// Spec: tasks/builds/support-desk-canonical/spec.md §8, §14.1, §14.7
//
// No DB access, no async. All functions are deterministic given their inputs.
// The reconciliation worker (C11), route layer, and tests all import from here.

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// DraftStatus
// ---------------------------------------------------------------------------

export type DraftStatus =
  | 'draft'
  | 'awaiting_review'
  | 'dispatching'
  | 'needs_reconciliation'
  | 'manually_marked_sent'
  | 'sent'
  | 'rejected'
  | 'failed'
  | 'expired'
  | 'superseded';

// ---------------------------------------------------------------------------
// isValidDraftStatusTransition
// ---------------------------------------------------------------------------

/**
 * Returns true for every permitted transition in the state machine.
 *
 * Terminal states: sent, rejected, failed, expired, superseded, manually_marked_sent
 * Post-terminal exceptions (the ONLY exits from terminal states):
 *   manually_marked_sent → sent            (back-link route resolves the sent_message_id)
 *   needs_reconciliation → failed          (manual resolve — give up)
 *   needs_reconciliation → manually_marked_sent  (operator manually marks it sent)
 *   needs_reconciliation → sent            (back-link route resolves)
 *   needs_reconciliation → dispatching     (retry_reconciliation re-enqueues dispatch)
 *
 * Explicit prohibition: dispatching → expired is blocked (expiry scanner must not
 * touch in-flight drafts; they transition to needs_reconciliation instead).
 */
export function isValidDraftStatusTransition(from: DraftStatus, to: DraftStatus): boolean {
  switch (from) {
    case 'draft':
      return to === 'awaiting_review' || to === 'superseded' || to === 'dispatching' || to === 'expired';

    case 'awaiting_review':
      return to === 'dispatching' || to === 'rejected' || to === 'superseded' || to === 'expired';

    case 'dispatching':
      // dispatching → expired is explicitly forbidden
      return to === 'sent' || to === 'needs_reconciliation' || to === 'failed';

    case 'needs_reconciliation':
      // The only non-terminal state that allows multiple exit paths (including
      // retry_reconciliation which re-enters dispatching, and manual resolve paths)
      return (
        to === 'failed' ||
        to === 'manually_marked_sent' ||
        to === 'sent' ||
        to === 'dispatching'
      );

    case 'manually_marked_sent':
      // Back-link route can resolve the sent_message_id, flipping to sent
      return to === 'sent';

    // Terminal states with no exit
    case 'sent':
    case 'rejected':
    case 'failed':
    case 'expired':
    case 'superseded':
      return false;

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// deriveActionIdempotencyKey
// ---------------------------------------------------------------------------

/**
 * Deterministic SHA-256 hex of `${connectorConfigId}:${ticketId}:${actionType}:${draftId}`.
 * Same inputs always produce the same key; a different draftId yields a different key.
 * Used to prevent duplicate dispatch of the same draft.
 */
export function deriveActionIdempotencyKey(input: {
  connectorConfigId: string;
  ticketId: string;
  actionType: 'reply' | 'internal_note';
  draftId: string;
}): string {
  const raw = `${input.connectorConfigId}:${input.ticketId}:${input.actionType}:${input.draftId}`;
  return createHash('sha256').update(raw).digest('hex');
}

// ---------------------------------------------------------------------------
// deriveInPlaceActionKey
// ---------------------------------------------------------------------------

/**
 * Deterministic SHA-256 hex for in-place mutations (status/assignment/tag changes)
 * that are NOT tied to a draft.
 *
 * Hash of `${connectorConfigId}:${ticketId}:${actionType}:${JSON.stringify(sortedPayload)}`
 * where sortedPayload has its keys sorted deterministically.
 */
export function deriveInPlaceActionKey(input: {
  connectorConfigId: string;
  ticketId: string;
  actionType: 'status_change' | 'assignment_change' | 'tag_change';
  payload: Record<string, unknown>;
}): string {
  const sortedPayload = Object.fromEntries(
    Object.keys(input.payload)
      .sort()
      .map((k) => [k, input.payload[k]]),
  );
  const raw = `${input.connectorConfigId}:${input.ticketId}:${input.actionType}:${JSON.stringify(sortedPayload)}`;
  return createHash('sha256').update(raw).digest('hex');
}

// ---------------------------------------------------------------------------
// planSameRunSupersession
// ---------------------------------------------------------------------------

/**
 * Returns whether to supersede a prior draft before inserting the new one.
 *
 * 'supersede_then_insert' when existingDraft != null AND its status is in
 *   ('draft', 'awaiting_review') — i.e. the prior draft is still pending review.
 * 'insert_only' otherwise (no active prior draft, or prior draft is past review).
 */
export function planSameRunSupersession(input: {
  existingDraft: { status: string } | null;
  newProposal: { visibility: string };
}): { action: 'insert_only' | 'supersede_then_insert' } {
  if (
    input.existingDraft !== null &&
    (input.existingDraft.status === 'draft' || input.existingDraft.status === 'awaiting_review')
  ) {
    return { action: 'supersede_then_insert' };
  }
  return { action: 'insert_only' };
}
