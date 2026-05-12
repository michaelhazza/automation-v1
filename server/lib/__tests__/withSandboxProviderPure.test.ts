import { describe, expect, test } from 'vitest';
import {
  classifyProviderSignal,
  extractRetryAfterMs,
  type ProviderSignal,
} from '../withSandboxProviderPure.js';

// ---------------------------------------------------------------------------
// classifyProviderSignal — transient / ambiguous / fatal classification
// ---------------------------------------------------------------------------

describe('classifyProviderSignal', () => {
  // ── Ambiguous ─────────────────────────────────────────────────────────────

  test('explicit ambiguous flag overrides everything', () => {
    expect(classifyProviderSignal({ ambiguous: true, status: 200 })).toEqual({ kind: 'ambiguous' });
    expect(classifyProviderSignal({ ambiguous: true, code: 'not_found' })).toEqual({ kind: 'ambiguous' });
  });

  test('known ambiguous code → ambiguous', () => {
    const codes: ProviderSignal['code'][] = [
      'provider_unknown',
      'sandbox_state_unknown',
      'status_unknown',
    ];
    for (const code of codes) {
      expect(classifyProviderSignal({ code }), `code=${String(code)}`).toEqual({ kind: 'ambiguous' });
    }
  });

  // ── Fatal ─────────────────────────────────────────────────────────────────

  test('known fatal code → fatal', () => {
    const codes: ProviderSignal['code'][] = [
      'not_found',
      'credential_denied',
      'invalid_request',
      'permission_denied',
      'quota_exceeded_hard',
    ];
    for (const code of codes) {
      expect(classifyProviderSignal({ code }), `code=${String(code)}`).toEqual({ kind: 'fatal' });
    }
  });

  test('4xx status (non-429) → fatal', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(classifyProviderSignal({ status }), `status=${status}`).toEqual({ kind: 'fatal' });
    }
  });

  // ── Transient ─────────────────────────────────────────────────────────────

  test('429 → transient (rate-limit, should retry)', () => {
    expect(classifyProviderSignal({ status: 429 })).toEqual({ kind: 'transient' });
  });

  test('5xx status → transient', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyProviderSignal({ status }), `status=${status}`).toEqual({ kind: 'transient' });
    }
  });

  // ── Unknown / empty signal ────────────────────────────────────────────────

  test('empty signal → transient (conservative retry)', () => {
    expect(classifyProviderSignal({})).toEqual({ kind: 'transient' });
  });

  test('unknown code with no status → transient', () => {
    expect(classifyProviderSignal({ code: 'some_unknown_code' })).toEqual({ kind: 'transient' });
  });

  // ── Priority ordering ─────────────────────────────────────────────────────

  test('ambiguous flag beats fatal code (ambiguous wins)', () => {
    expect(classifyProviderSignal({ ambiguous: true, code: 'not_found' })).toEqual({ kind: 'ambiguous' });
  });

  test('ambiguous code beats fatal status (ambiguous wins)', () => {
    expect(classifyProviderSignal({ code: 'provider_unknown', status: 404 })).toEqual({ kind: 'ambiguous' });
  });

  test('fatal code beats transient status', () => {
    expect(classifyProviderSignal({ code: 'not_found', status: 503 })).toEqual({ kind: 'fatal' });
  });
});

// ---------------------------------------------------------------------------
// extractRetryAfterMs — Retry-After hint extraction
// ---------------------------------------------------------------------------

describe('extractRetryAfterMs', () => {
  test('returns undefined when field absent', () => {
    expect(extractRetryAfterMs({})).toBeUndefined();
  });

  test('returns undefined for zero or negative values', () => {
    expect(extractRetryAfterMs({ retryAfterSeconds: 0 })).toBeUndefined();
    expect(extractRetryAfterMs({ retryAfterSeconds: -1 })).toBeUndefined();
  });

  test('converts seconds to ms for values < 1000', () => {
    expect(extractRetryAfterMs({ retryAfterSeconds: 5 })).toBe(5_000);
    expect(extractRetryAfterMs({ retryAfterSeconds: 10 })).toBe(10_000);
  });

  test('treats values >= 1000 as already ms', () => {
    expect(extractRetryAfterMs({ retryAfterSeconds: 1000 })).toBe(1_000);
    expect(extractRetryAfterMs({ retryAfterSeconds: 5000 })).toBe(5_000);
  });

  test('caps at 30 000 ms', () => {
    expect(extractRetryAfterMs({ retryAfterSeconds: 300 })).toBe(30_000);
    expect(extractRetryAfterMs({ retryAfterSeconds: 60_000 })).toBe(30_000);
  });

  test('1 second → 1000 ms (boundary)', () => {
    // 1 < 1000, so treated as seconds → 1 * 1000 = 1000 ms
    expect(extractRetryAfterMs({ retryAfterSeconds: 1 })).toBe(1_000);
  });
});
