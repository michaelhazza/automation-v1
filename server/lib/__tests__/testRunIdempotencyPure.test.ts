// testRunIdempotencyPure.test.ts — pure tests for deriveTestRunIdempotencyKey,
// canonicalStringify, and deriveTestRunIdempotencyCandidates.
//
// Runnable via:
//   npx tsx server/lib/__tests__/testRunIdempotencyPure.test.ts

import { expect, test } from 'vitest';
import {
  canonicalStringify,
  deriveTestRunIdempotencyCandidates,
  deriveTestRunIdempotencyKey,
} from '../testRunIdempotency.js';

function assertNotEqual(a: unknown, b: unknown, msg: string): void {
  if (a === b) {
    throw new Error(`${msg}: expected values to differ, got ${JSON.stringify(a)}`);
  }
}

// Freeze "now" for deterministic bucket selection in tests that must collide.
const origNow = Date.now;
function freezeTime(bucketIndex: number, windowSec: number, offsetMs = 1): void {
  Date.now = () => bucketIndex * windowSec * 1000 + offsetMs;
}
function restoreTime(): void {
  Date.now = origNow;
}

// ---------------------------------------------------------------------------
// canonicalStringify
// ---------------------------------------------------------------------------

test('canonicalStringify: object key order is normalised', () => {
  const a = canonicalStringify({ a: 1, b: 2, c: 3 });
  const b = canonicalStringify({ c: 3, a: 1, b: 2 });
  expect(a, 'reordered keys should produce identical output').toEqual(b);
});

test('canonicalStringify: nested objects sort recursively', () => {
  const a = canonicalStringify({ outer: { a: 1, b: 2 }, other: 'x' });
  const b = canonicalStringify({ other: 'x', outer: { b: 2, a: 1 } });
  expect(a, 'nested reorder should still collide').toEqual(b);
});

test('canonicalStringify: arrays preserve order', () => {
  assertNotEqual(
    canonicalStringify([1, 2, 3]),
    canonicalStringify([3, 2, 1]),
    'array order must be preserved',
  );
});

test('canonicalStringify: undefined in objects is omitted', () => {
  expect(canonicalStringify({ a: 1, b: undefined }), 'undefined keys dropped').toEqual(canonicalStringify({ a: 1 }));
});

test('canonicalStringify: undefined in arrays becomes null', () => {
  expect(canonicalStringify([1, undefined, 3]), 'undefined → null').toBe('[1,null,3]');
});

test('canonicalStringify: non-finite numbers become null', () => {
  expect(canonicalStringify({ x: NaN, y: Infinity }), 'non-finite → null').toBe('{"x":null,"y":null}');
});

test('canonicalStringify: null and primitives round-trip as JSON', () => {
  expect(canonicalStringify(null), 'null').toBe('null');
  expect(canonicalStringify(42), 'number').toBe('42');
  expect(canonicalStringify('hi'), 'string').toBe('"hi"');
  expect(canonicalStringify(true), 'bool').toBe('true');
});

// ---------------------------------------------------------------------------
// deriveTestRunIdempotencyKey
// ---------------------------------------------------------------------------

test('same inputs in same time bucket produce the same key', () => {
  freezeTime(123456, 10);
  try {
    const a = deriveTestRunIdempotencyKey({
      userId: 'u1', targetType: 'agent', targetId: 't1',
      input: { prompt: 'hello', inputJson: { x: 1 } },
    });
    const b = deriveTestRunIdempotencyKey({
      userId: 'u1', targetType: 'agent', targetId: 't1',
      input: { prompt: 'hello', inputJson: { x: 1 } },
    });
    expect(a, 'identical inputs should collide').toEqual(b);
  } finally { restoreTime(); }
});

test('logically-equivalent inputs with different key order collide', () => {
  freezeTime(123456, 10);
  try {
    const a = deriveTestRunIdempotencyKey({
      userId: 'u1', targetType: 'agent', targetId: 't1',
      input: { prompt: 'hello', inputJson: { a: 1, b: 2 } },
    });
    const b = deriveTestRunIdempotencyKey({
      userId: 'u1', targetType: 'agent', targetId: 't1',
      input: { inputJson: { b: 2, a: 1 }, prompt: 'hello' },
    });
    expect(a, 'canonical JSON should normalise key order').toEqual(b);
  } finally { restoreTime(); }
});

test('different userId produces a different key', () => {
  freezeTime(123456, 10);
  try {
    const a = deriveTestRunIdempotencyKey({ userId: 'u1', targetType: 'agent', targetId: 't1', input: {} });
    const b = deriveTestRunIdempotencyKey({ userId: 'u2', targetType: 'agent', targetId: 't1', input: {} });
    assertNotEqual(a, b, 'user separation failed');
  } finally { restoreTime(); }
});

test('different targetType produces a different key', () => {
  freezeTime(123456, 10);
  try {
    const a = deriveTestRunIdempotencyKey({ userId: 'u1', targetType: 'agent', targetId: 't1', input: {} });
    const b = deriveTestRunIdempotencyKey({ userId: 'u1', targetType: 'subaccount-agent', targetId: 't1', input: {} });
    assertNotEqual(a, b, 'targetType separation failed');
  } finally { restoreTime(); }
});

test('different targetId produces a different key', () => {
  freezeTime(123456, 10);
  try {
    const a = deriveTestRunIdempotencyKey({ userId: 'u1', targetType: 'agent', targetId: 't1', input: {} });
    const b = deriveTestRunIdempotencyKey({ userId: 'u1', targetType: 'agent', targetId: 't2', input: {} });
    assertNotEqual(a, b, 'targetId separation failed');
  } finally { restoreTime(); }
});

test('different input hash produces a different key', () => {
  freezeTime(123456, 10);
  try {
    const a = deriveTestRunIdempotencyKey({
      userId: 'u1', targetType: 'agent', targetId: 't1',
      input: { prompt: 'hello' },
    });
    const b = deriveTestRunIdempotencyKey({
      userId: 'u1', targetType: 'agent', targetId: 't1',
      input: { prompt: 'world' },
    });
    assertNotEqual(a, b, 'input hash separation failed');
  } finally { restoreTime(); }
});

test('adjacent time buckets produce different keys', () => {
  freezeTime(123456, 10);
  const a = deriveTestRunIdempotencyKey({
    userId: 'u1', targetType: 'agent', targetId: 't1', input: { prompt: 'hi' },
  });
  freezeTime(123457, 10);
  try {
    const b = deriveTestRunIdempotencyKey({
      userId: 'u1', targetType: 'agent', targetId: 't1', input: { prompt: 'hi' },
    });
    assertNotEqual(a, b, 'time bucket separation failed');
  } finally { restoreTime(); }
});

test('client key hint participates in the hash (distinct hints → distinct keys)', () => {
  freezeTime(123456, 10);
  try {
    const a = deriveTestRunIdempotencyKey({
      userId: 'u1', targetType: 'agent', targetId: 't1', input: {}, clientKeyHint: 'A',
    });
    const b = deriveTestRunIdempotencyKey({
      userId: 'u1', targetType: 'agent', targetId: 't1', input: {}, clientKeyHint: 'B',
    });
    assertNotEqual(a, b, 'client hint separation failed');
  } finally { restoreTime(); }
});

test('same client key hint + same input collides inside bucket', () => {
  freezeTime(123456, 10);
  try {
    const a = deriveTestRunIdempotencyKey({
      userId: 'u1', targetType: 'agent', targetId: 't1', input: { x: 1 }, clientKeyHint: 'same',
    });
    const b = deriveTestRunIdempotencyKey({
      userId: 'u1', targetType: 'agent', targetId: 't1', input: { x: 1 }, clientKeyHint: 'same',
    });
    expect(a, 'matching hint should collide').toEqual(b);
  } finally { restoreTime(); }
});

test('derived key has the expected prefix and length', () => {
  freezeTime(123456, 10);
  try {
    const a = deriveTestRunIdempotencyKey({
      userId: 'u1', targetType: 'org-skill', targetId: 't1', input: {},
    });
    if (!a.startsWith('test-run:org-skill:')) {
      throw new Error(`bad prefix: ${a}`);
    }
    const suffix = a.split(':')[2];
    if (suffix.length !== 32) {
      throw new Error(`bad suffix length: ${suffix.length}`);
    }
  } finally { restoreTime(); }
});

// ---------------------------------------------------------------------------
// deriveTestRunIdempotencyCandidates (dual-bucket)
// ---------------------------------------------------------------------------

test('candidates: current and previous bucket keys differ', () => {
  freezeTime(123456, 10);
  try {
    const [current, previous] = deriveTestRunIdempotencyCandidates({
      userId: 'u1', targetType: 'agent', targetId: 't1', input: { x: 1 },
    });
    assertNotEqual(current, previous, 'current and previous must differ');
  } finally { restoreTime(); }
});

test('candidates: current key matches deriveTestRunIdempotencyKey output', () => {
  freezeTime(123456, 10);
  try {
    const primary = deriveTestRunIdempotencyKey({
      userId: 'u1', targetType: 'agent', targetId: 't1', input: { x: 1 },
    });
    const [current] = deriveTestRunIdempotencyCandidates({
      userId: 'u1', targetType: 'agent', targetId: 't1', input: { x: 1 },
    });
    expect(current, 'current candidate must equal primary key').toEqual(primary);
  } finally { restoreTime(); }
});

test('candidates: boundary-straddling retries overlap', () => {
  // Request 1 late in bucket N.
  freezeTime(123456, 10, 9999);
  const [currentA, previousA] = deriveTestRunIdempotencyCandidates({
    userId: 'u1', targetType: 'agent', targetId: 't1', input: { x: 1 },
  });
  // Request 2 early in bucket N+1 — should see currentA as its previous.
  freezeTime(123457, 10, 1);
  try {
    const [currentB, previousB] = deriveTestRunIdempotencyCandidates({
      userId: 'u1', targetType: 'agent', targetId: 't1', input: { x: 1 },
    });
    expect(previousB, 'second request sees first request current as its previous').toEqual(currentA);
    assertNotEqual(currentB, currentA, 'current keys differ between buckets');
    assertNotEqual(previousA, previousB, 'previous keys differ between buckets');
  } finally { restoreTime(); }
});

console.log('');