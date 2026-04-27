/**
 * incidentIngestorThrottle.test.ts — Unit tests for the per-fingerprint throttle.
 *
 * Runnable via:
 *   NODE_ENV=test npx tsx server/services/__tests__/incidentIngestorThrottle.test.ts
 */

process.env.NODE_ENV = 'test';
// Set a short throttle window for tests (must be set before module import)
process.env.SYSTEM_INCIDENT_THROTTLE_MS = '50';

import {
  checkThrottle,
  getThrottledCount,
  getMapEvictionCount,
  __resetForTest,
} from '../incidentIngestorThrottle.js';

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

test('returns false on first call (pass-through)', () => {
  __resetForTest();
  const result = checkThrottle('fp-a');
  assertEqual(result, false, 'first call should not be throttled');
  assertEqual(getThrottledCount(), 0, 'throttle count should be 0');
});

test('returns true within throttle window (throttled)', () => {
  __resetForTest();
  checkThrottle('fp-b');
  const result = checkThrottle('fp-b');
  assertEqual(result, true, 'second call within window should be throttled');
  assertEqual(getThrottledCount(), 1, 'throttle count should be 1');
});

test('returns false after throttle window expires', async () => {
  __resetForTest();
  checkThrottle('fp-c');
  await sleep(60);
  const result = checkThrottle('fp-c');
  assertEqual(result, false, 'call after window should not be throttled');
});

test('different fingerprints are throttled independently', () => {
  __resetForTest();
  checkThrottle('fp-x');
  const result = checkThrottle('fp-y');
  assertEqual(result, false, 'different fingerprint should not be throttled');
});

test('evicts oldest entry when map is at capacity', () => {
  __resetForTest();
  for (let i = 0; i < 50_000; i++) {
    checkThrottle(`fill-${i}`);
  }
  const evictionsBefore = getMapEvictionCount();
  checkThrottle('overflow-fp');
  assert(getMapEvictionCount() > evictionsBefore, 'eviction should have occurred at capacity');
});

test('reset clears state between runs', () => {
  __resetForTest();
  checkThrottle('fp-reset');
  checkThrottle('fp-reset');

  __resetForTest();
  const result = checkThrottle('fp-reset');
  assertEqual(result, false, 'after reset, known fingerprint should pass');
  assertEqual(getThrottledCount(), 0, 'throttled count reset to 0');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

Promise.all(pending).then(() => {
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
