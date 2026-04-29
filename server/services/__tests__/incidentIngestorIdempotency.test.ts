/**
 * incidentIngestorIdempotency.test.ts — Unit tests for the idempotency LRU.
 *
 * Runnable via:
 *   NODE_ENV=test npx tsx server/services/__tests__/incidentIngestorIdempotency.test.ts
 */

process.env.NODE_ENV = 'test';
// Set a short TTL for the TTL-expiry test (must be set before module import)
process.env.SYSTEM_INCIDENT_IDEMPOTENCY_TTL_SECONDS = '0.1'; // 100ms

import { expect, test } from 'vitest';
import {
  checkAndRecord,
  getIdempotentHitCount,
  getIdempotentEvictionCount,
  __resetForTest,
} from '../incidentIngestorIdempotency.js';

const pending: Promise<void>[] = [];

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
  expect(result, 'first call should be miss').toBe(false);
  expect(getIdempotentHitCount(), 'hit count after miss').toBe(0);
});

test('returns true for duplicate key within TTL (hit)', () => {
  __resetForTest();
  checkAndRecord('fp:idkey-2');
  const result = checkAndRecord('fp:idkey-2');
  expect(result, 'second call should be hit').toBe(true);
  expect(getIdempotentHitCount(), 'hit count after one hit').toBe(1);
});

test('returns false for a key after TTL expires', async () => {
  __resetForTest();
  checkAndRecord('fp:ttl-test');
  await sleep(150); // wait beyond the 100ms TTL
  const result = checkAndRecord('fp:ttl-test');
  expect(result, 'call after TTL expiry should be miss').toBe(false);
});

test('returns false for different keys', () => {
  __resetForTest();
  checkAndRecord('fp:idkey-a');
  const result = checkAndRecord('fp:idkey-b');
  expect(result, 'different key should be miss').toBe(false);
});

test('evicts oldest entry when cap is reached', () => {
  __resetForTest();
  const MAX = 10_000;
  for (let i = 0; i < MAX; i++) {
    checkAndRecord(`fp:fill-${i}`);
  }
  const evictionsBefore = getIdempotentEvictionCount();
  checkAndRecord('fp:overflow-key');
  expect(getIdempotentEvictionCount() > evictionsBefore, 'at least one eviction should have occurred').toBeTruthy();
  // The oldest entry (fill-0) should have been evicted, so it's a miss now
  const result = checkAndRecord('fp:fill-0');
  expect(result, 'evicted entry should be miss on re-check').toBe(false);
});

test('hit count increments correctly across multiple hits', () => {
  __resetForTest();
  checkAndRecord('fp:multi-1');   // miss
  checkAndRecord('fp:multi-1');   // hit 1
  checkAndRecord('fp:multi-1');   // hit 2
  checkAndRecord('fp:multi-2');   // miss
  expect(getIdempotentHitCount(), 'should have 2 hits').toBe(2);
});

test('reset clears state between runs', () => {
  __resetForTest();
  checkAndRecord('fp:reset-test');
  checkAndRecord('fp:reset-test'); // hit

  __resetForTest();
  const result = checkAndRecord('fp:reset-test'); // should be miss after reset
  expect(result, 'after reset, known key should be miss').toBe(false);
  expect(getIdempotentHitCount(), 'hit count reset to 0').toBe(0);
  expect(getIdempotentEvictionCount(), 'eviction count reset to 0').toBe(0);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

Promise.all(pending).then(() => {
});
