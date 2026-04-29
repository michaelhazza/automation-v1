/**
 * incidentIngestorThrottle.test.ts — Unit tests for the per-fingerprint throttle.
 *
 * Runnable via:
 *   NODE_ENV=test npx tsx server/services/__tests__/incidentIngestorThrottle.test.ts
 */

process.env.NODE_ENV = 'test';
// Set a short throttle window for tests (must be set before module import)
process.env.SYSTEM_INCIDENT_THROTTLE_MS = '50';

import { expect, test } from 'vitest';
import {
  checkThrottle,
  getThrottledCount,
  getMapEvictionCount,
  __resetForTest,
} from '../incidentIngestorThrottle.js';

const pending: Promise<void>[] = [];

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('returns false on first call (pass-through)', () => {
  __resetForTest();
  const result = checkThrottle('fp-a');
  expect(result, 'first call should not be throttled').toBe(false);
  expect(getThrottledCount(), 'throttle count should be 0').toBe(0);
});

test('returns true within throttle window (throttled)', () => {
  __resetForTest();
  checkThrottle('fp-b');
  const result = checkThrottle('fp-b');
  expect(result, 'second call within window should be throttled').toBe(true);
  expect(getThrottledCount(), 'throttle count should be 1').toBe(1);
});

test('returns false after throttle window expires', async () => {
  __resetForTest();
  checkThrottle('fp-c');
  await sleep(60);
  const result = checkThrottle('fp-c');
  expect(result, 'call after window should not be throttled').toBe(false);
});

test('different fingerprints are throttled independently', () => {
  __resetForTest();
  checkThrottle('fp-x');
  const result = checkThrottle('fp-y');
  expect(result, 'different fingerprint should not be throttled').toBe(false);
});

test('evicts oldest entry when map is at capacity', () => {
  __resetForTest();
  for (let i = 0; i < 50_000; i++) {
    checkThrottle(`fill-${i}`);
  }
  const evictionsBefore = getMapEvictionCount();
  checkThrottle('overflow-fp');
  expect(getMapEvictionCount() > evictionsBefore, 'eviction should have occurred at capacity').toBeTruthy();
});

test('reset clears state between runs', () => {
  __resetForTest();
  checkThrottle('fp-reset');
  checkThrottle('fp-reset');

  __resetForTest();
  const result = checkThrottle('fp-reset');
  expect(result, 'after reset, known fingerprint should pass').toBe(false);
  expect(getThrottledCount(), 'throttled count reset to 0').toBe(0);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

Promise.all(pending).then(() => {
});
