/**
 * memoryBlockSynthesisServicePure.test.ts — scoring + tier + passive-age
 *
 * Spec: docs/memory-and-briefings-spec.md §5.7 (S11)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/memoryBlockSynthesisServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  scoreCluster,
  decideTier,
  passiveAgeDecision,
  SYNTHESIS_MIN_CLUSTER_SIZE,
  PASSIVE_AGE_CYCLES,
  HIGH_CONFIDENCE_THRESHOLD,
  MEDIUM_CONFIDENCE_THRESHOLD,
} from '../memoryBlockSynthesisServicePure.js';

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

console.log('');
console.log('memoryBlockSynthesisServicePure — synthesis decisions (§5.7 S11)');
console.log('');

// ---------------------------------------------------------------------------
// scoreCluster
// ---------------------------------------------------------------------------

console.log('scoreCluster:');

test('below min size → 0', () => {
  const c = scoreCluster({
    size: SYNTHESIS_MIN_CLUSTER_SIZE - 1,
    avgQuality: 1,
    avgCitedCount: 5,
    coherence: 1,
  });
  expect(c, 'zero').toBe(0);
});

test('perfect cluster → ~1.0', () => {
  const c = scoreCluster({
    size: SYNTHESIS_MIN_CLUSTER_SIZE,
    avgQuality: 1,
    avgCitedCount: 10,
    coherence: 1,
  });
  expect(c >= HIGH_CONFIDENCE_THRESHOLD, `score ${c} should cross high threshold`).toBe(true);
});

test('weak cluster → low tier', () => {
  const c = scoreCluster({
    size: SYNTHESIS_MIN_CLUSTER_SIZE,
    avgQuality: 0.4,
    avgCitedCount: 0,
    coherence: 0.3,
  });
  expect(c < MEDIUM_CONFIDENCE_THRESHOLD, `weak → ${c} should be below medium`).toBe(true);
});

// ---------------------------------------------------------------------------
// decideTier
// ---------------------------------------------------------------------------

console.log('decideTier:');

test('>= high → high', () => {
  expect(decideTier(HIGH_CONFIDENCE_THRESHOLD), 'at boundary').toBe('high');
  expect(decideTier(0.95), 'above').toBe('high');
});

test('medium band', () => {
  expect(decideTier(MEDIUM_CONFIDENCE_THRESHOLD), 'at lower boundary').toBe('medium');
  expect(decideTier(0.7), 'mid-band').toBe('medium');
});

test('below medium → low', () => {
  expect(decideTier(MEDIUM_CONFIDENCE_THRESHOLD - 0.01), 'below medium').toBe('low');
  expect(decideTier(0), 'floor').toBe('low');
});

// ---------------------------------------------------------------------------
// passiveAgeDecision
// ---------------------------------------------------------------------------

console.log('passiveAgeDecision:');

test('draft survived cycles → activate', () => {
  const d = passiveAgeDecision({ cycles: PASSIVE_AGE_CYCLES, status: 'draft' });
  expect(d.shouldActivate, 'activate').toBe(true);
});

test('draft under cycle count → stay', () => {
  const d = passiveAgeDecision({ cycles: PASSIVE_AGE_CYCLES - 1, status: 'draft' });
  expect(d.shouldActivate, 'not yet').toBe(false);
});

test('active block → no-op', () => {
  const d = passiveAgeDecision({ cycles: 10, status: 'active' });
  expect(d.shouldActivate, 'already active').toBe(false);
});

test('rejected block → no-op', () => {
  const d = passiveAgeDecision({ cycles: 10, status: 'rejected' });
  expect(d.shouldActivate, 'rejected does not activate').toBe(false);
});

test('pending_review block → no passive age', () => {
  const d = passiveAgeDecision({ cycles: 10, status: 'pending_review' });
  expect(d.shouldActivate, 'pending_review stays').toBe(false);
});

console.log('');
console.log('');
