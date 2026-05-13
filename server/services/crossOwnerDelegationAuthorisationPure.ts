// crossOwnerDelegationAuthorisationPure.ts — pure helpers for cross-owner delegation auth.
// No DB, no IO. Personal-assistant-v2-operator spec §5.4.

export type AuthorisationResult =
  | { authorised: true; target_owner_user_id: string; signal: 'user_named_owner' | 'parent_agent_explicit_capability' }
  | { authorised: false; clarifying_question: string };

// Matches possessive name references in normalised intent text.
// Examples:
//   "check Michael's calendar"          → { candidateName: 'Michael' }
//   "my colleague Jane's inbox"         → { candidateName: 'Jane' }
//   "John's assistant"                  → { candidateName: 'John' }
// Returns null when no pattern found.
const POSSESSIVE_RE = /(?:my colleague\s+)?(\b[A-Za-z]+(?:[-\u0027\u2018\u2019][A-Za-z]+)*)[\u0027\u2018\u2019]s\s+\w/;

/**
 * Layer 1: detect possessive named-owner references in normalised intent text.
 */
export function detectNamedOwnerReference(
  normalisedIntentText: string,
): { candidateName: string } | null {
  const match = POSSESSIVE_RE.exec(normalisedIntentText);
  if (!match) return null;
  return { candidateName: match[1] };
}

/**
 * Layer 2: validate a trusted parent-agent tool-call payload.
 * Returns the target_owner_user_id if explicitly present and non-empty; null otherwise.
 */
export function extractTrustedToolCallOwner(
  toolCallPayload: Record<string, unknown>,
): string | null {
  const val = toolCallPayload['target_owner_user_id'];
  if (typeof val === 'string' && val.trim().length > 0) return val.trim();
  return null;
}

/**
 * Normalise a display name candidate for subaccount member matching:
 * lowercase, trim whitespace, collapse internal spaces.
 */
export function normaliseDisplayName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}
