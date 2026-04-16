/**
 * memoryEntryQualityServicePure.test.ts
 *
 * Pure unit tests for decay-factor computation and prune eligibility decisions.
 * Spec: docs/memory-and-briefings-spec.md §4.1 (S1)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/memoryEntryQualityServicePure.test.ts
 */

import {
  computeDecayFactor,
  isPruneEligible,
} from '../../services/memoryEntryQualityServicePure.js';
import {
  DECAY_RATE,
  DECAY_WINDOW_DAYS,
  PRUNE_THRESHOLD,
  PRUNE_AGE_DAYS,
} from '../../config/limits.js';

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

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, label: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `${label} — expected ~${expected} (±${tolerance}), got ${actual}`,
    );
  }
}

function assertTrue(condition: boolean, label: string) {
  if (!condition) {
    throw new Error(`${label} — expected true, got false`);
  }
}

function assertFalse(condition: boolean, label: string) {
  if (condition) {
    throw new Error(`${label} — expected false, got true`);
  }
}

const now = new Date('2026-04-16T12:00:00.000Z');

// ---------------------------------------------------------------------------
// computeDecayFactor — accessed within window
// ---------------------------------------------------------------------------

console.log('');
console.log('computeDecayFactor');
console.log('');

test('accessed today → factor = 1.0 (no decay)', () => {
  const lastAccessedAt = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1h ago
  const factor = computeDecayFactor({ qualityScore: 0.8, lastAccessedAt, now });
  assertEqual(factor, 1.0, 'factor within window');
});

test('accessed exactly at DECAY_WINDOW_DAYS boundary → factor = 1.0', () => {
  const lastAccessedAt = new Date(
    now.getTime() - DECAY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const factor = computeDecayFactor({ qualityScore: 0.8, lastAccessedAt, now });
  assertEqual(factor, 1.0, 'exact boundary = no decay');
});

test('accessed 1 day over window → decays by DECAY_RATE', () => {
  const daysOver = 1;
  const lastAccessedAt = new Date(
    now.getTime() - (DECAY_WINDOW_DAYS + daysOver) * 24 * 60 * 60 * 1000,
  );
  const factor = computeDecayFactor({ qualityScore: 0.8, lastAccessedAt, now });
  const expected = 1 - DECAY_RATE * daysOver;
  assertApprox(factor, expected, 0.001, `1 day over window → ${expected}`);
});

test('accessed far over window → factor clamps to 0', () => {
  const lastAccessedAt = new Date(
    now.getTime() - (DECAY_WINDOW_DAYS + 1000) * 24 * 60 * 60 * 1000,
  );
  const factor = computeDecayFactor({ qualityScore: 0.8, lastAccessedAt, now });
  assertEqual(factor, 0, 'factor clamped to 0 — never negative');
});

// ---------------------------------------------------------------------------
// computeDecayFactor — never accessed
// ---------------------------------------------------------------------------

test('never accessed (null) → factor reflects full-window decay', () => {
  const factor = computeDecayFactor({ qualityScore: 0.8, lastAccessedAt: null, now });
  const expected = Math.max(0, 1 - DECAY_RATE * DECAY_WINDOW_DAYS);
  assertApprox(factor, expected, 0.001, `null → ${expected}`);
});

test('never accessed → factor is ≥ 0', () => {
  const factor = computeDecayFactor({ qualityScore: 0.8, lastAccessedAt: null, now });
  assertTrue(factor >= 0, 'factor ≥ 0 for never-accessed');
});

// ---------------------------------------------------------------------------
// isPruneEligible — prune threshold + age
// ---------------------------------------------------------------------------

console.log('');
console.log('isPruneEligible');
console.log('');

const oldDate = new Date(now.getTime() - (PRUNE_AGE_DAYS + 10) * 24 * 60 * 60 * 1000);
const freshDate = new Date(now.getTime() - (PRUNE_AGE_DAYS - 10) * 24 * 60 * 60 * 1000);

test('low score + old entry → prune eligible', () => {
  const result = isPruneEligible({ qualityScore: PRUNE_THRESHOLD - 0.01, createdAt: oldDate, now });
  assertTrue(result, 'old low-quality entry is prune eligible');
});

test('low score + fresh entry → NOT prune eligible', () => {
  const result = isPruneEligible({ qualityScore: PRUNE_THRESHOLD - 0.01, createdAt: freshDate, now });
  assertFalse(result, 'young low-quality entry is NOT pruned');
});

test('high score + old entry → NOT prune eligible', () => {
  const result = isPruneEligible({ qualityScore: PRUNE_THRESHOLD + 0.1, createdAt: oldDate, now });
  assertFalse(result, 'old high-quality entry is NOT pruned');
});

test('score exactly at threshold → NOT prune eligible (threshold is exclusive lower)', () => {
  const result = isPruneEligible({ qualityScore: PRUNE_THRESHOLD, createdAt: oldDate, now });
  assertFalse(result, 'score == PRUNE_THRESHOLD → NOT pruned');
});

test('score 0 + old entry → prune eligible', () => {
  const result = isPruneEligible({ qualityScore: 0, createdAt: oldDate, now });
  assertTrue(result, 'zero-score old entry is pruned');
});

test('entry exactly at PRUNE_AGE_DAYS → prune eligible', () => {
  const exactDate = new Date(now.getTime() - PRUNE_AGE_DAYS * 24 * 60 * 60 * 1000);
  const result = isPruneEligible({ qualityScore: 0, createdAt: exactDate, now });
  assertTrue(result, 'entry at exact PRUNE_AGE_DAYS boundary is pruned');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
