import { describe, expect, it } from 'vitest';

import { classifyRuntimeError } from '../operatorRuntimeErrors.js';

describe('classifyRuntimeError', () => {
  describe('session_unavailable signals (spec §3.7 item 1)', () => {
    it('classifies HTTP 401 as session_unavailable', () => {
      expect(classifyRuntimeError({ kind: 'http', status: 401 })).toBe('session_unavailable');
    });

    it('classifies HTTP 403 as session_unavailable', () => {
      expect(classifyRuntimeError({ kind: 'http', status: 403 })).toBe('session_unavailable');
    });

    it('classifies HTTP 429 with Retry-After >= 60s as session_unavailable', () => {
      expect(
        classifyRuntimeError({ kind: 'http', status: 429, retryAfterSeconds: 60 }),
      ).toBe('session_unavailable');
    });

    it('classifies HTTP 429 with Retry-After > 60s as session_unavailable', () => {
      expect(
        classifyRuntimeError({ kind: 'http', status: 429, retryAfterSeconds: 300 }),
      ).toBe('session_unavailable');
    });

    it('classifies HTTP 429 with "session suspended" body as session_unavailable', () => {
      expect(
        classifyRuntimeError({
          kind: 'http',
          status: 429,
          body: 'Your session suspended due to overuse',
        }),
      ).toBe('session_unavailable');
    });

    it('classifies HTTP 429 with Retry-After < 60s as transient (not unavailable)', () => {
      expect(
        classifyRuntimeError({ kind: 'http', status: 429, retryAfterSeconds: 30 }),
      ).toBe('transient');
    });

    it('classifies broker refresh failure with expired_refresh_token as session_unavailable', () => {
      expect(
        classifyRuntimeError({ kind: 'broker_refresh', code: 'expired_refresh_token' }),
      ).toBe('session_unavailable');
    });

    it('classifies broker refresh failure with provider_revoked as session_unavailable', () => {
      expect(
        classifyRuntimeError({ kind: 'broker_refresh', code: 'provider_revoked' }),
      ).toBe('session_unavailable');
    });

    it('classifies broker refresh failure with insufficient_scope as session_unavailable', () => {
      expect(
        classifyRuntimeError({ kind: 'broker_refresh', code: 'insufficient_scope' }),
      ).toBe('session_unavailable');
    });

    it('classifies connection errors > 3 consecutive as session_unavailable', () => {
      expect(
        classifyRuntimeError({ kind: 'connection', consecutiveFailures: 4 }),
      ).toBe('session_unavailable');
    });

    it('classifies connection errors == 3 consecutive as NOT session_unavailable (boundary)', () => {
      // > 3 means strictly greater than 3; exactly 3 is still transient
      expect(
        classifyRuntimeError({ kind: 'connection', consecutiveFailures: 3 }),
      ).toBe('transient');
    });

    it('classifies connection errors <= 3 as transient', () => {
      expect(
        classifyRuntimeError({ kind: 'connection', consecutiveFailures: 1 }),
      ).toBe('transient');
      expect(
        classifyRuntimeError({ kind: 'connection', consecutiveFailures: 2 }),
      ).toBe('transient');
    });
  });

  describe('other error classes', () => {
    it('classifies HTTP 5xx as transient', () => {
      expect(classifyRuntimeError({ kind: 'http', status: 500 })).toBe('transient');
      expect(classifyRuntimeError({ kind: 'http', status: 503 })).toBe('transient');
    });

    it('classifies HTTP 4xx (non-401/403/429) as permanent', () => {
      expect(classifyRuntimeError({ kind: 'http', status: 400 })).toBe('permanent');
      expect(classifyRuntimeError({ kind: 'http', status: 404 })).toBe('permanent');
    });

    it('classifies unknown broker codes as auth', () => {
      expect(classifyRuntimeError({ kind: 'broker_refresh', code: 'some_other_error' })).toBe(
        'auth',
      );
    });

    it('classifies profile_corruption signal', () => {
      expect(
        classifyRuntimeError({ kind: 'profile_corruption', reason: 'volume_corrupted' }),
      ).toBe('profile_corruption');
    });

    it('classifies concurrency signal', () => {
      expect(classifyRuntimeError({ kind: 'concurrency', reason: 'cap_exceeded' })).toBe(
        'concurrency',
      );
    });

    it('classifies budget signal', () => {
      expect(classifyRuntimeError({ kind: 'budget', reason: 'budget_exceeded' })).toBe('budget');
    });

    it('classifies unknown error objects as transient', () => {
      expect(classifyRuntimeError(new Error('unknown'))).toBe('transient');
      expect(classifyRuntimeError('some string error')).toBe('transient');
      expect(classifyRuntimeError(null)).toBe('transient');
    });
  });
});
