/**
 * incidentIngestorIdempotency.test.ts — Unit tests for the idempotency LRU.
 *
 * Runnable via:
 *   NODE_ENV=test npx tsx server/services/__tests__/incidentIngestorIdempotency.test.ts
 */

process.env.NODE_ENV = 'test';
// Set a short TTL for the TTL-expiry test (must be set before module import)
process.env.SYSTEM_INCIDENT_IDEMPOTENCY_TTL_SECONDS = '0.05'; // 50ms

import {
  checkAndRecord,
  getIdempotentHitCount,
  getIdempotentEvictionCount,
  __resetForTest,
} from '../incidentIngestorIdempotency.js';

let passed = 0;
let failed = 0;
const pending: Promise<void>[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      pending.push(
        result.then(() => {
          passed++;
          console.log(`  PASS  ${name}`);
        }).catch((err: unknown) => {
          failed++;
          console.log(`  FAIL  ${name}`);
          console.log(`        ${err instanceof Error ? err.message : err}`);
        })
      );
    } else {
      passed++;
      console.log(`  PASS  ${name}`);
    }
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('returns false for a new key (miss)', () => {
  __resetForTest();
  const result = checkAndRecord('fp:idkey-1');
  assertEqual(result, false, 'first call should be miss');
  assertEqual(getIdempotentHitCount(), 0, 'hit count after miss');
});

test('returns true for duplicate key within TTL (hit)', () => {
  __resetForTest();
  checkAndRecord('fp:idkey-2');
  const result = checkAndRecord('fp:idkey-2');
  assertEqual(result, true, 'second call should be hit');
  assertEqual(getIdempotentHitCount(), 1, 'hit count after one hit');
});

test('returns false for a key after TTL expires', async () => {
  __resetForTest();
  checkAndRecord('fp:ttl-test');
  await sleep(70); // wait beyond the 50ms TTL
  const result = checkAndRecord('fp:ttl-test');
  assertEqual(result, false, 'call after TTL expiry should be miss');
});

test('returns false for different keys', () => {
  __resetForTest();
  checkAndRecord('fp:idkey-a');
  const result = checkAndRecord('fp:idkey-b');
  assertEqual(result, false, 'different key should be miss');
});

test('evicts oldest entry when cap is reached', () => {
  __resetForTest();
  const MAX = 10_000;
  for (let i = 0; i < MAX; i++) {
    checkAndRecord(`fp:fill-${i}`);
  }
  const evictionsBefore = getIdempotentEvictionCount();
  checkAndRecord('fp:overflow-key');
  assert(getIdempotentEvictionCount() > evictionsBefore, 'at least one eviction should have occurred');
  // The oldest entry (fill-0) should have been evicted, so it's a miss now
  const result = checkAndRecord('fp:fill-0');
  assertEqual(result, false, 'evicted entry should be miss on re-check');
});

test('hit count increments correctly across multiple hits', () => {
  __resetForTest();
  checkAndRecord('fp:multi-1');   // miss
  checkAndRecord('fp:multi-1');   // hit 1
  checkAndRecord('fp:multi-1');   // hit 2
  checkAndRecord('fp:multi-2');   // miss
  assertEqual(getIdempotentHitCount(), 2, 'should have 2 hits');
});

test('reset clears state between runs', () => {
  __resetForTest();
  checkAndRecord('fp:reset-test');
  checkAndRecord('fp:reset-test'); // hit

  __resetForTest();
  const result = checkAndRecord('fp:reset-test'); // should be miss after reset
  assertEqual(result, false, 'after reset, known key should be miss');
  assertEqual(getIdempotentHitCount(), 0, 'hit count reset to 0');
  assertEqual(getIdempotentEvictionCount(), 0, 'eviction count reset to 0');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

Promise.all(pending).then(() => {
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
