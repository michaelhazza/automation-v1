import { expect, test } from 'vitest';
import { classifyRouterError } from '../llmRouterErrorMappingPure.js';
import { ParseFailureError } from '../../lib/parseFailureError.js';
import { ProviderTimeoutError } from '../llmRouterTimeoutPure.js';

// ---------------------------------------------------------------------------
// Pins the error → ledger-status classifier used by llmRouter's failure path.
//
// The April 2026 timeout hardening exposed a prior gap: the non-retryable
// branch `throw err`-ed without writing a ledger row, so PROVIDER_TIMEOUT,
// PROVIDER_NOT_CONFIGURED, and auth errors disappeared from the P&L surface.
// The fix routes every non-retryable through the ledger-write-on-failure path,
// which uses this classifier. These tests guarantee that classifier never
// returns an `undefined` status — every error shape produces a writable row.
// ---------------------------------------------------------------------------

test('PROVIDER_TIMEOUT → status=timeout (new hardening path)', () => {
  const err = new ProviderTimeoutError(600_000, 'anthropic/claude-sonnet-4-6');
  const cls = classifyRouterError(err);
  expect(cls.status).toBe('timeout');
  expect(cls.abortReason).toBe(null);
  expect(cls.parseFailureExcerpt).toBe(null);
});

test('CLIENT_DISCONNECTED without abortReason → status=client_disconnected', () => {
  const err = { code: 'CLIENT_DISCONNECTED', message: 'socket closed' };
  const cls = classifyRouterError(err);
  expect(cls.status).toBe('client_disconnected');
  expect(cls.abortReason).toBe(null);
});

test('CLIENT_DISCONNECTED + caller_timeout → aborted_by_caller + caller_timeout', () => {
  const err = { code: 'CLIENT_DISCONNECTED', abortReason: 'caller_timeout' as const };
  const cls = classifyRouterError(err);
  expect(cls.status).toBe('aborted_by_caller');
  expect(cls.abortReason).toBe('caller_timeout');
});

test('CLIENT_DISCONNECTED + caller_cancel → aborted_by_caller + caller_cancel', () => {
  const err = { code: 'CLIENT_DISCONNECTED', abortReason: 'caller_cancel' as const };
  const cls = classifyRouterError(err);
  expect(cls.status).toBe('aborted_by_caller');
  expect(cls.abortReason).toBe('caller_cancel');
});

test('CLIENT_DISCONNECTED + garbage abortReason → client_disconnected (no invalid abort_reason)', () => {
  const err = { code: 'CLIENT_DISCONNECTED', abortReason: 'something_weird' };
  const cls = classifyRouterError(err);
  expect(cls.status).toBe('client_disconnected');
  expect(cls.abortReason).toBe(null);
});

test('PROVIDER_UNAVAILABLE → status=provider_unavailable', () => {
  const err = { code: 'PROVIDER_UNAVAILABLE' };
  expect(classifyRouterError(err).status).toBe('provider_unavailable');
});

test('PROVIDER_NOT_CONFIGURED → status=provider_not_configured (non-retryable, still ledgered)', () => {
  const err = { code: 'PROVIDER_NOT_CONFIGURED' };
  expect(classifyRouterError(err).status).toBe('provider_not_configured');
});

test('ParseFailureError → status=parse_failure + excerpt preserved', () => {
  const err = new ParseFailureError({ rawExcerpt: '{"partial":', message: 'schema failed' });
  const cls = classifyRouterError(err);
  expect(cls.status).toBe('parse_failure');
  expect(cls.parseFailureExcerpt).toBe('{"partial":');
  expect(cls.abortReason).toBe(null);
});

test('Generic Error (no code) → status=error (fallthrough, never skipped)', () => {
  const err = new Error('kaboom');
  const cls = classifyRouterError(err);
  expect(cls.status).toBe('error');
});

test('Auth-shaped error (401) → status=error — still writes a ledger row', () => {
  // isNonRetryableError treats statusCode=401 as non-retryable. Under the
  // April 2026 fix, these now `break providerLoop` instead of `throw err`
  // and flow through this classifier. The fallthrough 'error' status is
  // the right ledger value — we don't have a dedicated 'auth_error' status
  // and blurring it under 'error' keeps the LLM_REQUEST_STATUSES enum stable.
  const err = { statusCode: 401, code: 'AUTH_INVALID', message: 'bad api key' };
  expect(classifyRouterError(err).status).toBe('error');
});

test('null error → status=error (defensive — no throw, no undefined)', () => {
  expect(classifyRouterError(null).status).toBe('error');
});

test('undefined error → status=error (defensive — no throw, no undefined)', () => {
  expect(classifyRouterError(undefined).status).toBe('error');
});

test('string error → status=error (defensive — no throw, no undefined)', () => {
  expect(classifyRouterError('just a string').status).toBe('error');
});

test('classifier never returns an undefined status — 100% ledger coverage', () => {
  // The whole point of the fix: every error shape produces a writable row.
  const samples: unknown[] = [
    new ProviderTimeoutError(1000, 'x/y'),
    new ParseFailureError({ rawExcerpt: 'x' }),
    new Error('generic'),
    { code: 'CLIENT_DISCONNECTED' },
    { code: 'CLIENT_DISCONNECTED', abortReason: 'caller_timeout' },
    { code: 'PROVIDER_UNAVAILABLE' },
    { code: 'PROVIDER_NOT_CONFIGURED' },
    { code: 'UNKNOWN_CODE' },
    { statusCode: 403 },
    {},
    null,
    undefined,
    'string',
    42,
  ];
  for (const s of samples) {
    const cls = classifyRouterError(s);
    expect(typeof cls.status === 'string' && cls.status.length > 0).toBeTruthy();
  }
});
