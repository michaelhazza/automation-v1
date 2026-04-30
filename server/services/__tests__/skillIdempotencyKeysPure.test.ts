import { expect, test } from 'vitest';
import {
  canonicaliseForHash,
  hashKeyShape,
  ttlClassToExpiresAt,
  IdempotencyKeyShapeError,
  assertHandlerInvokedWithClaim,
} from '../skillIdempotencyKeysPure.js';

// ---------------------------------------------------------------------------
// hashKeyShape — dot-path resolution
// ---------------------------------------------------------------------------

test('hashKeyShape — top-level fields resolve correctly', () => {
  const input = { invoice_id: 'inv_001', dunning_step: 2 };
  const hash = hashKeyShape(['invoice_id', 'dunning_step'], input);
  expect(typeof hash).toBe('string');
  expect(hash.length).toBe(64); // SHA-256 hex
});

test('hashKeyShape — nested dot-paths resolve correctly', () => {
  const input = { customer: { id: 'cust_42', name: 'Acme' }, amount: 100 };
  const hash = hashKeyShape(['customer.id', 'amount'], input);
  expect(typeof hash).toBe('string');
  expect(hash.length).toBe(64);
});

// ---------------------------------------------------------------------------
// hashKeyShape — missing field throws IdempotencyKeyShapeError
// ---------------------------------------------------------------------------

test('hashKeyShape — missing top-level field throws IdempotencyKeyShapeError', () => {
  const input = { invoice_id: 'inv_001' };
  let _err: unknown;
  try { hashKeyShape(['invoice_id', 'dunning_step'], input); } catch (e) { _err = e; }
  expect(_err instanceof IdempotencyKeyShapeError).toBeTruthy();
  expect((_err as IdempotencyKeyShapeError).missingField).toBe('dunning_step');
});

test('hashKeyShape — missing nested dot-path field throws IdempotencyKeyShapeError', () => {
  const input = { customer: { name: 'Acme' } }; // missing customer.id
  let _err: unknown;
  try { hashKeyShape(['customer.id'], input); } catch (e) { _err = e; }
  expect(_err instanceof IdempotencyKeyShapeError).toBeTruthy();
  expect((_err as IdempotencyKeyShapeError).missingField).toBe('customer.id');
});

// ---------------------------------------------------------------------------
// hashKeyShape — collision determinism
// ---------------------------------------------------------------------------

test('hashKeyShape — same key values in different input key order → same hash', () => {
  const inputA = { engagement_id: 'eng_1', billing_period_start: '2026-01-01', billing_period_end: '2026-01-31', extra_field: 'ignored' };
  const inputB = { billing_period_end: '2026-01-31', extra_field: 'ignored', engagement_id: 'eng_1', billing_period_start: '2026-01-01' };
  const keyShape = ['engagement_id', 'billing_period_start', 'billing_period_end'];
  const hashA = hashKeyShape(keyShape, inputA);
  const hashB = hashKeyShape(keyShape, inputB);
  expect(hashA).toBe(hashB);
});

test('hashKeyShape — different key values → different hash', () => {
  const inputA = { invoice_id: 'inv_001' };
  const inputB = { invoice_id: 'inv_002' };
  const hashA = hashKeyShape(['invoice_id'], inputA);
  const hashB = hashKeyShape(['invoice_id'], inputB);
  expect(hashA).not.toBe(hashB);
});

// ---------------------------------------------------------------------------
// ttlClassToExpiresAt
// ---------------------------------------------------------------------------

test("ttlClassToExpiresAt('permanent') → null", () => {
  const result = ttlClassToExpiresAt('permanent');
  expect(result).toBe(null);
});

test("ttlClassToExpiresAt('long') → Date roughly 30 days out", () => {
  const before = Date.now();
  const result = ttlClassToExpiresAt('long');
  const after = Date.now();
  expect(result instanceof Date).toBeTruthy();
  const expected = 30 * 24 * 60 * 60 * 1000;
  const elapsed = result.getTime() - before;
  const tolerance = after - before + 100; // account for test execution time
  expect(elapsed >= expected - 100).toBeTruthy();
  expect(elapsed <= expected + tolerance).toBeTruthy();
});

test("ttlClassToExpiresAt('short') → Date roughly 14 days out", () => {
  const before = Date.now();
  const result = ttlClassToExpiresAt('short');
  const after = Date.now();
  expect(result instanceof Date).toBeTruthy();
  const expected = 14 * 24 * 60 * 60 * 1000;
  const elapsed = result.getTime() - before;
  const tolerance = after - before + 100;
  expect(elapsed >= expected - 100).toBeTruthy();
  expect(elapsed <= expected + tolerance).toBeTruthy();
});

// ---------------------------------------------------------------------------
// canonicaliseForHash
// ---------------------------------------------------------------------------

test('canonicaliseForHash — object key order independent', () => {
  const a = canonicaliseForHash({ z: 1, a: 2, m: 3 });
  const b = canonicaliseForHash({ a: 2, m: 3, z: 1 });
  expect(a).toBe(b);
  expect(a).toBe('{"a":2,"m":3,"z":1}');
});

test('canonicaliseForHash — undefined values omitted from objects', () => {
  const result = canonicaliseForHash({ a: 1, b: undefined, c: 3 });
  expect(result).toBe('{"a":1,"c":3}');
  // Verify the result is the same as an object without the undefined key
  const withoutUndefined = canonicaliseForHash({ a: 1, c: 3 });
  expect(result).toBe(withoutUndefined);
});

test('canonicaliseForHash — -0 normalised to 0', () => {
  const negZero = canonicaliseForHash(-0);
  const posZero = canonicaliseForHash(0);
  expect(negZero).toBe('0');
  expect(posZero).toBe('0');
  expect(negZero).toBe(posZero);
});

test('canonicaliseForHash — NaN throws TypeError', () => {
  let _err: unknown;
  try { canonicaliseForHash(Number.NaN); } catch (e) { _err = e; }
  expect(_err instanceof TypeError).toBeTruthy();
  expect((_err as TypeError).message.includes('NaN')).toBeTruthy();
});

test('canonicaliseForHash — Infinity throws TypeError', () => {
  expect(() => canonicaliseForHash(Infinity)).toThrow(TypeError);
  expect(() => canonicaliseForHash(-Infinity)).toThrow(TypeError);
});

test('canonicaliseForHash — string NFC normalisation (é as NFD vs NFC)', () => {
  // é as NFC (U+00E9)
  const nfc = 'é'; // precomposed é
  // é as NFD (U+0065 U+0301) — e + combining acute accent
  const nfd = 'é';
  // They look the same visually but have different byte representations
  expect(nfc, 'NFD and NFC forms should be different strings before normalisation').not.toBe(nfd);
  const canonNfc = canonicaliseForHash(nfc);
  const canonNfd = canonicaliseForHash(nfd);
  // After NFC normalisation, both should produce the same canonical string
  expect(canonNfc, 'NFC and NFD forms should canonicalise to the same string').toBe(canonNfd);
});

test('canonicaliseForHash — arrays preserve order', () => {
  const a = canonicaliseForHash([1, 2, 3]);
  const b = canonicaliseForHash([3, 2, 1]);
  expect(a).not.toBe(b);
});

test('canonicaliseForHash — null preserved as null', () => {
  const result = canonicaliseForHash(null);
  expect(result).toBe('null');
});

test('canonicaliseForHash — deeply nested objects are recursively sorted', () => {
  const a = canonicaliseForHash({ outer: { z: 1, a: 2 } });
  const b = canonicaliseForHash({ outer: { a: 2, z: 1 } });
  expect(a).toBe(b);
});

// ---------------------------------------------------------------------------
// assertHandlerInvokedWithClaim
// ---------------------------------------------------------------------------

test('assertHandlerInvokedWithClaim(true) — no-op in test env (NODE_ENV=test)', () => {
  // Should not throw when isFirstWriter is true
  expect(() => assertHandlerInvokedWithClaim(true)).not.toThrow();
});

test('assertHandlerInvokedWithClaim(false) in test env — throws', () => {
  const original = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'test';
  try {
    let _err: unknown;
    try { assertHandlerInvokedWithClaim(false); } catch (e) { _err = e; }
    expect(_err instanceof Error).toBeTruthy();
    expect((_err as Error).message.includes('isFirstWriter=false')).toBeTruthy();
  } finally {
    process.env['NODE_ENV'] = original;
  }
});

// Spec AC #37(c) — production no-op contract
test('assertHandlerInvokedWithClaim(false) in production env — returns silently (no-op)', () => {
  const original = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'production';
  try {
    expect(() => assertHandlerInvokedWithClaim(false)).not.toThrow();
  } finally {
    process.env['NODE_ENV'] = original;
  }
});
