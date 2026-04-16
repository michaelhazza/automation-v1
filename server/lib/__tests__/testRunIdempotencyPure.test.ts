// testRunIdempotencyPure.test.ts — pure tests for deriveTestRunIdempotencyKey.
//
// Runnable via:
//   npx tsx server/lib/__tests__/testRunIdempotencyPure.test.ts

import { deriveTestRunIdempotencyKey } from '../testRunIdempotency.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assertEqual(a: unknown, b: unknown, msg: string): void {
  if (a !== b) {
    throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function assertNotEqual(a: unknown, b: unknown, msg: string): void {
  if (a === b) {
    throw new Error(`${msg}: expected values to differ, got ${JSON.stringify(a)}`);
  }
}

// Freeze "now" for deterministic bucket selection in tests that must collide.
const origNow = Date.now;
function freezeTime(bucketIndex: number, windowSec: number): void {
  Date.now = () => bucketIndex * windowSec * 1000 + 1; // +1ms into the bucket
}
function restoreTime(): void {
  Date.now = origNow;
}

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
    assertEqual(a, b, 'identical inputs should collide');
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
    assertEqual(a, b, 'matching hint should collide');
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

console.log('');
console.log(`testRunIdempotencyPure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
