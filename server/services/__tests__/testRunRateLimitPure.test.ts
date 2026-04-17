/**
 * testRunRateLimitPure.test.ts — Pure tests for Feature 2 rate limiter.
 *
 * Covers:
 *   - First call succeeds (no prior state)
 *   - Calls within the limit succeed
 *   - Call at limit boundary throws 429
 *   - Timestamps outside the window do not count
 *   - Different users have independent limits
 *   - Reset clears stored state
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/testRunRateLimitPure.test.ts
 */

import { checkTestRunRateLimit, _resetWindowStoreForTest } from '../../lib/testRunRateLimit.js';
import { TEST_RUN_RATE_LIMIT_PER_HOUR } from '../../config/limits.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

const HOUR_MS = 60 * 60 * 1000;
const userId = 'user-test-001';
const userId2 = 'user-test-002';

// ─── Tests ─────────────────────────────────────────────────────────────────

await test('first call succeeds with no prior state', () => {
  _resetWindowStoreForTest();
  // Should not throw
  checkTestRunRateLimit(userId);
});

await test(`${TEST_RUN_RATE_LIMIT_PER_HOUR - 1} calls succeed within limit`, () => {
  _resetWindowStoreForTest();
  for (let i = 0; i < TEST_RUN_RATE_LIMIT_PER_HOUR - 1; i++) {
    checkTestRunRateLimit(userId);
  }
});

await test(`exactly ${TEST_RUN_RATE_LIMIT_PER_HOUR} calls in window succeed (boundary)`, () => {
  _resetWindowStoreForTest();
  for (let i = 0; i < TEST_RUN_RATE_LIMIT_PER_HOUR; i++) {
    checkTestRunRateLimit(userId);
  }
});

await test(`${TEST_RUN_RATE_LIMIT_PER_HOUR + 1}th call in window throws 429`, () => {
  _resetWindowStoreForTest();
  for (let i = 0; i < TEST_RUN_RATE_LIMIT_PER_HOUR; i++) {
    checkTestRunRateLimit(userId);
  }
  let caught: unknown;
  try {
    checkTestRunRateLimit(userId);
  } catch (e) {
    caught = e;
  }
  assert(caught !== undefined, 'Expected throw but did not throw');
  const err = caught as { statusCode?: number; message?: string };
  assert(err.statusCode === 429, `Expected 429, got ${err.statusCode}`);
  assert(typeof err.message === 'string' && err.message.includes('rate limit'), `Unexpected message: ${err.message}`);
});

await test('timestamps older than the window do not count against the limit', () => {
  _resetWindowStoreForTest();
  const originalNow = Date.now;
  let fakeNow = Date.now();
  Date.now = () => fakeNow;

  try {
    // Fill the window with old timestamps (now - 2 hours)
    fakeNow = originalNow() - HOUR_MS * 2;
    for (let i = 0; i < TEST_RUN_RATE_LIMIT_PER_HOUR; i++) {
      checkTestRunRateLimit(userId);
    }

    // Advance time to now — old timestamps should have expired
    fakeNow = originalNow();
    // This should succeed because old timestamps are pruned
    checkTestRunRateLimit(userId);
  } finally {
    Date.now = originalNow;
  }
});

await test('different users have independent rate limit windows', () => {
  _resetWindowStoreForTest();
  // Exhaust limit for user 1
  for (let i = 0; i < TEST_RUN_RATE_LIMIT_PER_HOUR; i++) {
    checkTestRunRateLimit(userId);
  }
  let caught: unknown;
  try { checkTestRunRateLimit(userId); } catch (e) { caught = e; }
  assert(caught !== undefined, 'user 1 should be rate-limited');

  // user 2 should have a clean window
  checkTestRunRateLimit(userId2);
});

await test('reset clears stored state', () => {
  _resetWindowStoreForTest();
  // Exhaust limit
  for (let i = 0; i < TEST_RUN_RATE_LIMIT_PER_HOUR; i++) {
    checkTestRunRateLimit(userId);
  }
  // Reset
  _resetWindowStoreForTest();
  // Should succeed again
  checkTestRunRateLimit(userId);
});

// ─── Summary ───────────────────────────────────────────────────────────────

console.log(`\ntestRunRateLimitPure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
