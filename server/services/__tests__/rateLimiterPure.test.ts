/**
 * rateLimiterPure.test.ts — Pure-unit tests for the sliding-window math helper
 * `computeEffectiveCount(prevCount, currentCount, elapsedFractionOfCurrentWindow)`.
 *
 * Spec §6.2.3, §12 test matrix.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/rateLimiterPure.test.ts
 */
import { expect, test } from 'vitest';
import { computeEffectiveCount } from '../../lib/inboundRateLimiterPure.js';

// Boundary moment: elapsedFraction = 0 → previous window contributes fully.
test('boundary: elapsed=0 — full prev contribution', () => {
  // 100 prev * (1 - 0) + 5 curr = 105
  expect(computeEffectiveCount(100, 5, 0)).toBe(105);
});

// Mid-window: elapsedFraction = 0.5 → half of prev + all of curr.
test('mid-window: elapsed=0.5 — half prev contribution', () => {
  // 100 * 0.5 + 5 = 55
  expect(computeEffectiveCount(100, 5, 0.5)).toBe(55);
});

// Full window (just before rollover): elapsedFraction = 1 → no prev contribution.
test('full window: elapsed=1 — zero prev contribution', () => {
  // 100 * 0 + 5 = 5
  expect(computeEffectiveCount(100, 5, 1)).toBe(5);
});

// Clamp lower bound: spec mandates clamp on slightly-out-of-range inputs.
test('clamp lower: elapsed=-1e-9 treated as 0', () => {
  expect(computeEffectiveCount(100, 5, -1e-9)).toBe(105);
});

// Clamp upper bound: elapsed > 1 treated as 1.
test('clamp upper: elapsed=1+1e-9 treated as 1', () => {
  expect(computeEffectiveCount(100, 5, 1 + 1e-9)).toBe(5);
});

// Empty prev window: prev=0 means weighted contribution is 0; effective = curr only.
test('empty prev: prev=0 — effective equals curr', () => {
  expect(computeEffectiveCount(0, 7, 0.3)).toBe(7);
});

// Empty curr window (request just opened): effective = prev * (1 - elapsed).
test('empty curr at rollover: curr=0 — effective is weighted prev', () => {
  // 60 * (1 - 0.25) = 45
  expect(computeEffectiveCount(60, 0, 0.25)).toBe(45);
});
