/**
 * operatorSessionLifecycleServicePure.ts — Pure (no DB / no env) helpers for
 * operator session lifecycle management.
 *
 * operator-session-identity chunk 2.
 *
 * Exports:
 *   - UsabilityState — union of all valid session usability states
 *   - RefreshFailureBucket — classification buckets for token-refresh failures
 *   - RefreshFailureClassification — full classification result shape
 *   - InvalidStateTransitionError — thrown by callers attempting a forbidden transition
 *   - classifyRefreshFailure(error) — map an unknown error to a RefreshFailureClassification
 *   - isValidTransition(from, to) — check whether a state transition is permitted
 *   - isTerminalState(state) — true for 'revoked' and 'disabled'
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UsabilityState =
  | 'connected_usable'
  | 'connected_needs_consent'
  | 'connected_needs_reauth'
  | 'connected_unverified'
  | 'revoked'
  | 'disabled';

export type RefreshFailureBucket =
  | 'expired_refresh_token'
  | 'provider_revoked'
  | 'insufficient_scope'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'unknown';

export interface RefreshFailureClassification {
  bucket: RefreshFailureBucket;
  marksUnusable: boolean;
  nextState: UsabilityState | null;
  shouldAlert: boolean;
}

// ---------------------------------------------------------------------------
// InvalidStateTransitionError
// ---------------------------------------------------------------------------

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly from: UsabilityState,
    public readonly to: UsabilityState,
  ) {
    super(`Invalid state transition: ${from} → ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

// ---------------------------------------------------------------------------
// State transition table — spec §7.5
//
// Allowed transitions expressed as Map<from, Set<to>>.
// Terminal states ('revoked', 'disabled') are not present as keys, making
// any transition FROM them return false by absence.
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS = new Map<UsabilityState, Set<UsabilityState>>([
  [
    'connected_needs_consent',
    new Set<UsabilityState>(['connected_usable', 'disabled']),
  ],
  [
    'connected_needs_reauth',
    new Set<UsabilityState>(['connected_usable', 'disabled']),
  ],
  [
    'connected_unverified',
    new Set<UsabilityState>(['connected_usable', 'disabled']),
  ],
  [
    'connected_usable',
    new Set<UsabilityState>([
      'connected_needs_consent',
      'connected_needs_reauth',
      'revoked',
      'disabled',
      // NOTE: connected_usable → connected_unverified is explicitly forbidden per spec §7.5
    ]),
  ],
  // 'revoked' and 'disabled' have no outgoing transitions (terminal states)
]);

export function isValidTransition(from: UsabilityState, to: UsabilityState): boolean {
  return ALLOWED_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function isTerminalState(state: UsabilityState): boolean {
  return state === 'revoked' || state === 'disabled';
}

// ---------------------------------------------------------------------------
// classifyRefreshFailure — spec §9.5
//
// Inspection order (first match wins):
//   1. rate_limited  — HTTP 429 or (no status) 'rate_limit' in message
//   2. provider_revoked — HTTP 401 + revoked_token / access_denied / consent_required
//   3. expired_refresh_token — HTTP 401 + invalid_grant / expired_token
//   4. insufficient_scope — HTTP 403 + 'insufficient_scope' / 'scope' in message
//   5. provider_unavailable — HTTP 5xx OR network-error keywords in message
//   6. unknown — everything else
// ---------------------------------------------------------------------------

function extractStatus(error: unknown): number | null {
  if (error == null || typeof error !== 'object') return null;
  const e = error as Record<string, unknown>;
  if (typeof e['status'] === 'number') return e['status'];
  if (typeof e['statusCode'] === 'number') return e['statusCode'];
  const resp = e['response'];
  if (resp != null && typeof resp === 'object') {
    const r = resp as Record<string, unknown>;
    if (typeof r['status'] === 'number') return r['status'];
  }
  return null;
}

function extractMessage(error: unknown): string {
  if (error == null || typeof error !== 'object') return '';
  const e = error as Record<string, unknown>;
  return typeof e['message'] === 'string' ? e['message'] : '';
}

// Exact-case keywords: Node.js error codes that are already uppercase in practice
const NETWORK_KEYWORDS_EXACT = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'];
// Lowercase-compare keywords: matches axios "Network Error" (capital N) and "timeout" variants
const NETWORK_KEYWORDS_LOWER = ['network', 'timeout'];

export function classifyRefreshFailure(error: unknown): RefreshFailureClassification {
  const status = extractStatus(error);
  const message = extractMessage(error);
  const msgLower = message.toLowerCase();

  // 1. rate_limited — HTTP 429 always; message-only fallback only when status is absent
  //    (prevents a 401 with "rate_limit policy violated" from bypassing the 401 buckets below)
  if (status === 429 || (status == null && msgLower.includes('rate_limit'))) {
    return { bucket: 'rate_limited', marksUnusable: false, nextState: null, shouldAlert: false };
  }

  // 2. provider_revoked
  if (
    status === 401 &&
    (msgLower.includes('revoked_token') ||
      msgLower.includes('access_denied') ||
      msgLower.includes('consent_required'))
  ) {
    return {
      bucket: 'provider_revoked',
      marksUnusable: true,
      nextState: 'revoked',
      shouldAlert: true,
    };
  }

  // 3. expired_refresh_token
  if (
    status === 401 &&
    (msgLower.includes('invalid_grant') || msgLower.includes('expired_token'))
  ) {
    return {
      bucket: 'expired_refresh_token',
      marksUnusable: true,
      nextState: 'connected_needs_reauth',
      shouldAlert: false,
    };
  }

  // 4. insufficient_scope
  if (
    status === 403 &&
    (msgLower.includes('insufficient_scope') || msgLower.includes('scope'))
  ) {
    return {
      bucket: 'insufficient_scope',
      marksUnusable: true,
      nextState: 'connected_needs_reauth',
      shouldAlert: false,
    };
  }

  // 5. provider_unavailable — HTTP 5xx or network-error keywords
  if (
    (status != null && status >= 500 && status < 600) ||
    NETWORK_KEYWORDS_EXACT.some((kw) => message.includes(kw)) ||
    NETWORK_KEYWORDS_LOWER.some((kw) => msgLower.includes(kw))
  ) {
    return {
      bucket: 'provider_unavailable',
      marksUnusable: false,
      nextState: null,
      shouldAlert: false,
    };
  }

  // 6. unknown
  return {
    bucket: 'unknown',
    marksUnusable: true,
    nextState: 'connected_needs_reauth',
    shouldAlert: true,
  };
}
