/**
 * memoryBlockSynthesisServicePure.test.ts — scoring + tier + passive-age
 *
 * Spec: docs/memory-and-briefings-spec.md §5.7 (S11)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/memoryBlockSynthesisServicePure.test.ts
 */

import {
  scoreCluster,
  decideTier,
  passiveAgeDecision,
  SYNTHESIS_MIN_CLUSTER_SIZE,
  PASSIVE_AGE_CYCLES,
  HIGH_CONFIDENCE_THRESHOLD,
  MEDIUM_CONFIDENCE_THRESHOLD,
} from '../memoryBlockSynthesisServicePure.js';

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

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function assertTrue(cond: boolean, label: string) {
  if (!cond) throw new Error(`${label} — expected true`);
}

function assertFalse(cond: boolean, label: string) {
  if (cond) throw new Error(`${label} — expected false`);
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
  assertEqual(c, 0, 'zero');
});

test('perfect cluster → ~1.0', () => {
  const c = scoreCluster({
    size: SYNTHESIS_MIN_CLUSTER_SIZE,
    avgQuality: 1,
    avgCitedCount: 10,
    coherence: 1,
  });
  assertTrue(c >= HIGH_CONFIDENCE_THRESHOLD, `score ${c} should cross high threshold`);
});

test('weak cluster → low tier', () => {
  const c = scoreCluster({
    size: SYNTHESIS_MIN_CLUSTER_SIZE,
    avgQuality: 0.4,
    avgCitedCount: 0,
    coherence: 0.3,
  });
  assertTrue(c < MEDIUM_CONFIDENCE_THRESHOLD, `weak → ${c} should be below medium`);
});

// ---------------------------------------------------------------------------
// decideTier
// ---------------------------------------------------------------------------

console.log('decideTier:');

test('>= high → high', () => {
  assertEqual(decideTier(HIGH_CONFIDENCE_THRESHOLD), 'high', 'at boundary');
  assertEqual(decideTier(0.95), 'high', 'above');
});

test('medium band', () => {
  assertEqual(decideTier(MEDIUM_CONFIDENCE_THRESHOLD), 'medium', 'at lower boundary');
  assertEqual(decideTier(0.7), 'medium', 'mid-band');
});

test('below medium → low', () => {
  assertEqual(decideTier(MEDIUM_CONFIDENCE_THRESHOLD - 0.01), 'low', 'below medium');
  assertEqual(decideTier(0), 'low', 'floor');
});

// ---------------------------------------------------------------------------
// passiveAgeDecision
// ---------------------------------------------------------------------------

console.log('passiveAgeDecision:');

test('draft survived cycles → activate', () => {
  const d = passiveAgeDecision({ cycles: PASSIVE_AGE_CYCLES, status: 'draft' });
  assertTrue(d.shouldActivate, 'activate');
});

test('draft under cycle count → stay', () => {
  const d = passiveAgeDecision({ cycles: PASSIVE_AGE_CYCLES - 1, status: 'draft' });
  assertFalse(d.shouldActivate, 'not yet');
});

test('active block → no-op', () => {
  const d = passiveAgeDecision({ cycles: 10, status: 'active' });
  assertFalse(d.shouldActivate, 'already active');
});

test('rejected block → no-op', () => {
  const d = passiveAgeDecision({ cycles: 10, status: 'rejected' });
  assertFalse(d.shouldActivate, 'rejected does not activate');
});

test('pending_review block → no passive age', () => {
  const d = passiveAgeDecision({ cycles: 10, status: 'pending_review' });
  assertFalse(d.shouldActivate, 'pending_review stays');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
