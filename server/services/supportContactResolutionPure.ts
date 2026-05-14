// supportContactResolutionPure.ts — pure email-match resolver for support ticket customer identity.
//
// No DB access, no async. Receives a pre-loaded slice of canonical_contacts // verify-canonical-read-interface: allowed
// and resolves the canonical contact id for a given customer email.
//
// Called from connectorPollingService Phase C after the org's contacts are
// loaded once per poll cycle to avoid N+1 queries per ticket.

export interface EmailMatchResult {
  canonicalContactId: string | null;
  emailMatchCount: 0 | 1 | 'multiple';
}

/**
 * Resolve a canonical contact from a customer email against a pre-loaded set
 * of contacts. Matching is case-insensitive and trims leading/trailing
 * whitespace from the input email before comparing.
 *
 * Return values:
 *   - NULL/empty input  → { canonicalContactId: null, emailMatchCount: 0 }
 *   - Exactly 1 match   → { canonicalContactId: <id>, emailMatchCount: 1 }
 *   - Multiple matches  → { canonicalContactId: null, emailMatchCount: 'multiple' }
 *   - Zero matches      → { canonicalContactId: null, emailMatchCount: 0 }
 */
export function resolveByEmail(
  email: string | null | undefined,
  candidateContacts: Array<{ id: string; email: string }>,
): EmailMatchResult {
  const normalised = email?.trim().toLowerCase();
  if (!normalised) {
    return { canonicalContactId: null, emailMatchCount: 0 };
  }

  const matches = candidateContacts.filter(
    (c) => c.email.toLowerCase() === normalised,
  );

  if (matches.length === 0) {
    return { canonicalContactId: null, emailMatchCount: 0 };
  }
  if (matches.length === 1) {
    return { canonicalContactId: matches[0].id, emailMatchCount: 1 };
  }
  return { canonicalContactId: null, emailMatchCount: 'multiple' };
}
