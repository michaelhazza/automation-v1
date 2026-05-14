/**
 * operatorSessionLifecycleServicePure.test.ts — Unit tests for pure helpers
 * in operatorSessionLifecycleServicePure.ts.
 *
 * operator-session-identity chunk 2.
 *
 * Test posture: targeted Vitest only — do NOT run umbrella suites locally.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyRefreshFailure,
  isValidTransition,
  isTerminalState,
} from '../operatorSessionLifecycleServicePure.js';
import type { UsabilityState } from '../operatorSessionLifecycleServicePure.js';

// ---------------------------------------------------------------------------
// classifyRefreshFailure — one test per bucket + unexpected shape
// ---------------------------------------------------------------------------

describe('classifyRefreshFailure', () => {
  it('classifies rate_limited for HTTP 429', () => {
    const result = classifyRefreshFailure({ status: 429, message: 'Too many requests' });
    expect(result.bucket).toBe('rate_limited');
    expect(result.marksUnusable).toBe(false);
    expect(result.nextState).toBeNull();
    expect(result.shouldAlert).toBe(false);
  });

  it('classifies rate_limited when message contains "rate_limit" and no status is present', () => {
    const result = classifyRefreshFailure({ message: 'rate_limit exceeded' });
    expect(result.bucket).toBe('rate_limited');
    expect(result.marksUnusable).toBe(false);
    expect(result.nextState).toBeNull();
    expect(result.shouldAlert).toBe(false);
  });

  it('does NOT classify rate_limited when status is present but not 429, even if message contains "rate_limit"', () => {
    // A 401 with "rate_limit" in message must fall through to 401-specific buckets, not be
    // short-circuited here. A 400 with "rate_limit" similarly falls through to unknown.
    const result = classifyRefreshFailure({ status: 400, message: 'rate_limit exceeded' });
    expect(result.bucket).toBe('unknown');
  });

  it('classifies provider_revoked for HTTP 401 + revoked_token', () => {
    const result = classifyRefreshFailure({ status: 401, message: 'Token revoked_token error' });
    expect(result.bucket).toBe('provider_revoked');
    expect(result.marksUnusable).toBe(true);
    expect(result.nextState).toBe('revoked');
    expect(result.shouldAlert).toBe(true);
  });

  it('classifies provider_revoked for HTTP 401 + access_denied', () => {
    const result = classifyRefreshFailure({ status: 401, message: 'access_denied by provider' });
    expect(result.bucket).toBe('provider_revoked');
    expect(result.marksUnusable).toBe(true);
    expect(result.nextState).toBe('revoked');
    expect(result.shouldAlert).toBe(true);
  });

  it('classifies provider_revoked for HTTP 401 + consent_required', () => {
    const result = classifyRefreshFailure({ status: 401, message: 'consent_required for this scope' });
    expect(result.bucket).toBe('provider_revoked');
    expect(result.marksUnusable).toBe(true);
    expect(result.nextState).toBe('revoked');
    expect(result.shouldAlert).toBe(true);
  });

  it('classifies expired_refresh_token for HTTP 401 + invalid_grant', () => {
    const result = classifyRefreshFailure({ status: 401, message: 'invalid_grant: token expired' });
    expect(result.bucket).toBe('expired_refresh_token');
    expect(result.marksUnusable).toBe(true);
    expect(result.nextState).toBe('connected_needs_reauth');
    expect(result.shouldAlert).toBe(false);
  });

  it('classifies expired_refresh_token for HTTP 401 + expired_token', () => {
    const result = classifyRefreshFailure({ status: 401, message: 'expired_token detected' });
    expect(result.bucket).toBe('expired_refresh_token');
    expect(result.marksUnusable).toBe(true);
    expect(result.nextState).toBe('connected_needs_reauth');
    expect(result.shouldAlert).toBe(false);
  });

  it('classifies insufficient_scope for HTTP 403 + insufficient_scope', () => {
    const result = classifyRefreshFailure({ status: 403, message: 'insufficient_scope for calendar.read' });
    expect(result.bucket).toBe('insufficient_scope');
    expect(result.marksUnusable).toBe(true);
    expect(result.nextState).toBe('connected_needs_reauth');
    expect(result.shouldAlert).toBe(false);
  });

  it('classifies insufficient_scope for HTTP 403 + generic scope mention', () => {
    const result = classifyRefreshFailure({ status: 403, message: 'Required scope not granted' });
    expect(result.bucket).toBe('insufficient_scope');
    expect(result.marksUnusable).toBe(true);
    expect(result.nextState).toBe('connected_needs_reauth');
    expect(result.shouldAlert).toBe(false);
  });

  it('classifies provider_unavailable for HTTP 500', () => {
    const result = classifyRefreshFailure({ status: 500, message: 'Internal server error' });
    expect(result.bucket).toBe('provider_unavailable');
    expect(result.marksUnusable).toBe(false);
    expect(result.nextState).toBeNull();
    expect(result.shouldAlert).toBe(false);
  });

  it('classifies provider_unavailable for HTTP 503', () => {
    const result = classifyRefreshFailure({ status: 503, message: 'Service unavailable' });
    expect(result.bucket).toBe('provider_unavailable');
    expect(result.marksUnusable).toBe(false);
    expect(result.nextState).toBeNull();
    expect(result.shouldAlert).toBe(false);
  });

  it('classifies provider_unavailable for ECONNRESET network error', () => {
    const result = classifyRefreshFailure({ message: 'read ECONNRESET' });
    expect(result.bucket).toBe('provider_unavailable');
    expect(result.marksUnusable).toBe(false);
    expect(result.nextState).toBeNull();
    expect(result.shouldAlert).toBe(false);
  });

  it('classifies provider_unavailable for ETIMEDOUT network error', () => {
    const result = classifyRefreshFailure({ message: 'connect ETIMEDOUT 1.2.3.4:443' });
    expect(result.bucket).toBe('provider_unavailable');
  });

  it('classifies provider_unavailable for ENOTFOUND network error', () => {
    const result = classifyRefreshFailure({ message: 'getaddrinfo ENOTFOUND accounts.google.com' });
    expect(result.bucket).toBe('provider_unavailable');
  });

  it('classifies provider_unavailable for axios "Network Error" (capital N, no status)', () => {
    // axios throws { message: "Network Error" } with no status — must match via case-insensitive
    // NETWORK_KEYWORDS_LOWER so the capital N does not prevent detection.
    const result = classifyRefreshFailure({ message: 'Network Error' });
    expect(result.bucket).toBe('provider_unavailable');
    expect(result.marksUnusable).toBe(false);
    expect(result.nextState).toBeNull();
    expect(result.shouldAlert).toBe(false);
  });

  it('classifies provider_unavailable for "network" keyword in message', () => {
    const result = classifyRefreshFailure({ message: 'network failure occurred' });
    expect(result.bucket).toBe('provider_unavailable');
  });

  it('classifies provider_unavailable for "timeout" keyword in message', () => {
    const result = classifyRefreshFailure({ message: 'request timeout after 30s' });
    expect(result.bucket).toBe('provider_unavailable');
  });

  it('classifies unknown for unexpected error shape (no status, no recognised message)', () => {
    const result = classifyRefreshFailure({ message: 'Something completely unexpected happened' });
    expect(result.bucket).toBe('unknown');
    expect(result.marksUnusable).toBe(true);
    expect(result.nextState).toBe('connected_needs_reauth');
    expect(result.shouldAlert).toBe(true);
  });

  it('classifies unknown for null error', () => {
    const result = classifyRefreshFailure(null);
    expect(result.bucket).toBe('unknown');
    expect(result.marksUnusable).toBe(true);
    expect(result.nextState).toBe('connected_needs_reauth');
    expect(result.shouldAlert).toBe(true);
  });

  it('classifies unknown for empty object', () => {
    const result = classifyRefreshFailure({});
    expect(result.bucket).toBe('unknown');
  });

  it('reads status from error.statusCode when error.status is absent', () => {
    const result = classifyRefreshFailure({ statusCode: 429, message: 'Too many' });
    expect(result.bucket).toBe('rate_limited');
  });

  it('reads status from error.response.status when top-level fields are absent', () => {
    const result = classifyRefreshFailure({ response: { status: 429 }, message: '' });
    expect(result.bucket).toBe('rate_limited');
  });
});

// ---------------------------------------------------------------------------
// isValidTransition — all 6×6 = 36 pairs
// ---------------------------------------------------------------------------

describe('isValidTransition', () => {
  const ALL_STATES: UsabilityState[] = [
    'connected_usable',
    'connected_needs_consent',
    'connected_needs_reauth',
    'connected_unverified',
    'revoked',
    'disabled',
  ];

  // Explicitly allowed per spec §7.5
  const ALLOWED: Array<[UsabilityState, UsabilityState]> = [
    ['connected_needs_consent', 'connected_usable'],
    ['connected_needs_reauth', 'connected_usable'],
    ['connected_unverified', 'connected_usable'],
    ['connected_usable', 'connected_needs_consent'],
    ['connected_usable', 'connected_needs_reauth'],
    ['connected_usable', 'revoked'],
    ['connected_usable', 'disabled'],
    ['connected_needs_consent', 'disabled'],
    ['connected_needs_reauth', 'disabled'],
    ['connected_unverified', 'disabled'],
  ];

  const allowedSet = new Set(ALLOWED.map(([f, t]) => `${f}→${t}`));

  for (const from of ALL_STATES) {
    for (const to of ALL_STATES) {
      const expected = allowedSet.has(`${from}→${to}`);
      it(`${from} → ${to}: ${expected ? 'allowed' : 'forbidden'}`, () => {
        expect(isValidTransition(from, to)).toBe(expected);
      });
    }
  }

  // Explicit spot-checks for clarity
  it('connected_usable → connected_unverified is explicitly forbidden', () => {
    expect(isValidTransition('connected_usable', 'connected_unverified')).toBe(false);
  });

  it('revoked → connected_usable is forbidden (terminal)', () => {
    expect(isValidTransition('revoked', 'connected_usable')).toBe(false);
  });

  it('disabled → connected_usable is forbidden (terminal)', () => {
    expect(isValidTransition('disabled', 'connected_usable')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTerminalState
// ---------------------------------------------------------------------------

describe('isTerminalState', () => {
  it('returns true for revoked', () => {
    expect(isTerminalState('revoked')).toBe(true);
  });

  it('returns true for disabled', () => {
    expect(isTerminalState('disabled')).toBe(true);
  });

  it('returns false for connected_usable', () => {
    expect(isTerminalState('connected_usable')).toBe(false);
  });

  it('returns false for connected_needs_consent', () => {
    expect(isTerminalState('connected_needs_consent')).toBe(false);
  });

  it('returns false for connected_needs_reauth', () => {
    expect(isTerminalState('connected_needs_reauth')).toBe(false);
  });

  it('returns false for connected_unverified', () => {
    expect(isTerminalState('connected_unverified')).toBe(false);
  });
});
