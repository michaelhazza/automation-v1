/**
 * supportTicketServicePure — pure (no DB, no async) helpers for support ticket logic.
 *
 * Spec: tasks/builds/support-desk-canonical/spec.md §9, §11.5, §11.8
 */

import type { SupportCanonicalStatus } from '../adapters/integrationAdapter.js';

// ---------------------------------------------------------------------------
// Status transition table
//
// Valid statuses: open, pending_internal, waiting_on_customer, resolved, closed,
//                 unknown_provider_status
//
// Rules:
//   - Any → unknown_provider_status is FORBIDDEN via this function (quarantine
//     is only set by the fail-closed mapping path, never by a status transition).
//   - unknown_provider_status → open/pending_internal/waiting_on_customer/resolved/closed
//     is VALID (mapping-fix correction).
//   - closed → open is VALID (ticket reopening via human reply).
//   - resolved → open is VALID (provider can reopen).
//   - All other transitions among the five non-quarantine statuses are ALLOWED.
// ---------------------------------------------------------------------------

const KNOWN_STATUSES = new Set<SupportCanonicalStatus>([
  'open',
  'pending_internal',
  'waiting_on_customer',
  'resolved',
  'closed',
  'unknown_provider_status',
]);

/**
 * Returns true if the transition from `from` to `to` is a valid canonical
 * status transition. The only forbidden transitions are:
 *   - any → unknown_provider_status (never regress to quarantine via this path)
 *   - unknown_provider_status → unknown_provider_status (no-op transition)
 *   - from === to (trivially same — treated as invalid via no-op transition
 *     prevention; callers should guard before calling, but we reject here too)
 */
export function isValidTicketStatusTransition(
  from: SupportCanonicalStatus,
  to: SupportCanonicalStatus,
): boolean {
  if (!KNOWN_STATUSES.has(from) || !KNOWN_STATUSES.has(to)) {
    return false;
  }

  // Any → unknown_provider_status is forbidden
  if (to === 'unknown_provider_status') {
    return false;
  }

  // Same-status no-op is not a valid transition
  if (from === to) {
    return false;
  }

  // unknown_provider_status can transition to any non-quarantine status (mapping fix)
  // All other transitions among open/pending_internal/waiting_on_customer/resolved/closed are allowed
  return true;
}

// ---------------------------------------------------------------------------
// Filter deleted rows from agent reads
// ---------------------------------------------------------------------------

/**
 * Removes rows with providerDeleted === true from results returned to agents.
 * Agents must never see tombstoned tickets.
 */
export function filterDeletedFromAgentReads<T extends { providerDeleted: boolean }>(rows: T[]): T[] {
  return rows.filter((row) => !row.providerDeleted);
}

// ---------------------------------------------------------------------------
// Message redaction filter for audience
// ---------------------------------------------------------------------------

type RawMessage = {
  redacted: boolean;
  bodyText: string;
  bodyHtml: string | null;
  attachments: unknown;
};

/**
 * Applies redaction filtering to a message list based on the requesting
 * audience:
 *   - 'audit':    returns messages as-is (audit sees everything including redacted content)
 *   - 'agent':    redacted messages have bodyText replaced with '[redacted]',
 *                 bodyHtml set to null, and attachments set to null
 *   - 'human_ui': same as 'agent' (redaction display is a UI concern; data returns '[redacted]')
 */
export function applyMessageRedactionFilterForAudience(
  messages: RawMessage[],
  audience: 'agent' | 'human_ui' | 'audit',
): RawMessage[] {
  if (audience === 'audit') {
    return messages;
  }

  return messages.map((msg) => {
    if (!msg.redacted) return msg;
    return {
      ...msg,
      bodyText: '[redacted]',
      bodyHtml: null,
      attachments: null,
    };
  });
}

// ---------------------------------------------------------------------------
// Deletion-by-poll precondition guard
// ---------------------------------------------------------------------------

/**
 * Returns true only if it is safe to tombstone tickets by poll observation.
 * Tombstoning is only allowed during a full reconciliation run where every page
 * completed successfully and no rate-limiting occurred.
 *
 * Incremental polls MUST never tombstone — this function returns false for them.
 */
export function isDeletionByPollAllowed(input: {
  isFullReconciliation: boolean;
  anyPageFailed: boolean;
  anyRateLimited: boolean;
  allPagesComplete: boolean;
}): boolean {
  return (
    input.isFullReconciliation &&
    !input.anyPageFailed &&
    !input.anyRateLimited &&
    input.allPagesComplete
  );
}
