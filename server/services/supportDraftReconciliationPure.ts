// supportDraftReconciliationPure.ts — Pure decision module for draft reconciliation.
// Spec: tasks/builds/support-desk-canonical/spec.md §7, §8.5, §11.8, §18
//
// No DB access, no async. All functions are deterministic given their inputs.
// The reconciliation worker (C11) and the webhook back-link routine (C9)
// both import from this module.

import type { CanonicalTicketMessageData } from '../adapters/integrationAdapter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReconciliationDecision =
  | { kind: 'resolve_sent';   messageData: CanonicalTicketMessageData }
  | { kind: 'resolve_failed'; reason: string }
  | { kind: 'retry_after_ms'; ms: number }
  | { kind: 'surface_manual'; reason: string };

// ---------------------------------------------------------------------------
// decideOutcome
// ---------------------------------------------------------------------------

/**
 * Decides what to do with a draft in `needs_reconciliation` state.
 *
 * Priority order:
 *  1. Terminal draft status → resolve_failed (defensive; should not normally reach here)
 *  2. Budget exhausted → surface_manual
 *  3. Matching message found → resolve_sent
 *  4. Otherwise → retry_after_ms (exponential backoff, capped at 1 hour)
 */
export function decideOutcome(input: {
  draft: {
    id: string;
    status: string;
    reconciliationAttemptCount: number;
    proposedBodyText: string;
    proposedVisibility: string;
  };
  latestMessages: Array<{
    direction: string;
    visibility: string;
    bodyText: string;
    createdAtExternal: Date;
  }>;
  attemptCount: number;
  maxAttempts?: number; // default 5
}): ReconciliationDecision {
  const maxAttempts = input.maxAttempts ?? 5;

  // 1. Defensive: draft is already in a terminal state
  if (input.draft.status === 'failed' || input.draft.status === 'expired') {
    return { kind: 'resolve_failed', reason: 'draft_in_terminal_state' };
  }

  // 2. Budget exhausted — escalate to manual; NEVER auto-fail
  if (input.attemptCount >= maxAttempts) {
    return { kind: 'surface_manual', reason: 'max_attempts_exhausted' };
  }

  // 3. Check whether any landed message matches the draft's proposed body
  const proposedBody = input.draft.proposedBodyText;
  const match = input.latestMessages.find(
    (msg) =>
      msg.bodyText === proposedBody ||
      msg.bodyText.includes(proposedBody) ||
      proposedBody.includes(msg.bodyText),
  );

  if (match) {
    // Cast to CanonicalTicketMessageData — callers provide the full shape;
    // the pure function just forwards the matched object as messageData.
    return {
      kind: 'resolve_sent',
      messageData: match as unknown as CanonicalTicketMessageData,
    };
  }

  // 4. Exponential backoff — 30s * 2^n, capped at 1 hour
  const ms = Math.min(30_000 * Math.pow(2, input.attemptCount), 3_600_000);
  return { kind: 'retry_after_ms', ms };
}

// ---------------------------------------------------------------------------
// findBackLinkCandidate
// ---------------------------------------------------------------------------

/** Normalise body text for comparison: trim and collapse internal whitespace. */
function normaliseBody(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Finds a back-link candidate draft for a newly landed inbound/outbound message.
 *
 * Eligible drafts: status IN ('manually_marked_sent', 'sent') AND sent_message_id IS NULL.
 *
 * Match criteria:
 *   - Direction aligns: outbound message → reply draft; internal_note message → internal_note draft
 *   - Body text matches after normalisation (exact match on normalised text)
 *
 * Returns:
 *   - unique match   → { match: { id }, ambiguous: false }
 *   - multiple match → { match: null, ambiguous: true }
 *   - no match       → { match: null, ambiguous: false }
 */
export function findBackLinkCandidate(input: {
  newlyLandedMessage: {
    direction: string;
    visibility: string;
    bodyText: string;
    createdAtExternal: Date;
  };
  candidateDrafts: Array<{
    id: string;
    proposedBodyText: string;
    proposedVisibility: string;
    status: string;
    sentMessageId?: string | null;
  }>;
}): { match: { id: string } | null; ambiguous: boolean } {
  const { newlyLandedMessage, candidateDrafts } = input;

  // Only consider drafts in eligible statuses with no back-link yet
  const eligible = candidateDrafts.filter(
    (d) =>
      (d.status === 'manually_marked_sent' || d.status === 'sent') &&
      (d.sentMessageId == null),
  );

  // Determine the expected draft visibility from the message direction
  // outbound → public reply; internal_note → internal
  const expectedVisibility: string =
    newlyLandedMessage.direction === 'internal_note' ? 'internal' : 'public';

  const normalisedMessageBody = normaliseBody(newlyLandedMessage.bodyText);

  const matches = eligible.filter(
    (d) =>
      d.proposedVisibility === expectedVisibility &&
      normaliseBody(d.proposedBodyText) === normalisedMessageBody,
  );

  if (matches.length === 1) {
    return { match: { id: matches[0].id }, ambiguous: false };
  }
  if (matches.length > 1) {
    return { match: null, ambiguous: true };
  }
  return { match: null, ambiguous: false };
}
