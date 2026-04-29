/**
 * rateLimiterPure.test.ts — Pure-unit tests for the sliding-window math helper
 * `computeEffectiveCount(prevCount, currentCount, elapsedFractionOfCurrentWindow)`.
 *
 * Spec §6.2.3, §12 test matrix.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/rateLimiterPure.test.ts
 */
import { strict as assert } from 'node:assert';
import { computeEffectiveCount } from '../../lib/inboundRateLimiterPure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

// Boundary moment: elapsedFraction = 0 → previous window contributes fully.
test('boundary: elapsed=0 — full prev contribution', () => {
  // 100 prev * (1 - 0) + 5 curr = 105
  assert.equal(computeEffectiveCount(100, 5, 0), 105);
});

// Mid-window: elapsedFraction = 0.5 → half of prev + all of curr.
test('mid-window: elapsed=0.5 — half prev contribution', () => {
  // 100 * 0.5 + 5 = 55
  assert.equal(computeEffectiveCount(100, 5, 0.5), 55);
});

// Full window (just before rollover): elapsedFraction = 1 → no prev contribution.
test('full window: elapsed=1 — zero prev contribution', () => {
  // 100 * 0 + 5 = 5
  assert.equal(computeEffectiveCount(100, 5, 1), 5);
});

// Clamp lower bound: spec mandates clamp on slightly-out-of-range inputs.
test('clamp lower: elapsed=-1e-9 treated as 0', () => {
  assert.equal(computeEffectiveCount(100, 5, -1e-9), 105);
});

// Clamp upper bound: elapsed > 1 treated as 1.
test('clamp upper: elapsed=1+1e-9 treated as 1', () => {
  assert.equal(computeEffectiveCount(100, 5, 1 + 1e-9), 5);
});

// Empty prev window: prev=0 means weighted contribution is 0; effective = curr only.
test('empty prev: prev=0 — effective equals curr', () => {
  assert.equal(computeEffectiveCount(0, 7, 0.3), 7);
});

// Empty curr window (request just opened): effective = prev * (1 - elapsed).
test('empty curr at rollover: curr=0 — effective is weighted prev', () => {
  // 60 * (1 - 0.25) = 45
  assert.equal(computeEffectiveCount(60, 0, 0.25), 45);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
