/**
 * memoryEntryQualityServicePure.test.ts
 *
 * Pure unit tests for decay-factor computation and prune eligibility decisions.
 * Spec: docs/memory-and-briefings-spec.md §4.1 (S1)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/memoryEntryQualityServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  computeDecayFactor,
  isPruneEligible,
  decideUtilityAdjustment,
} from '../../services/memoryEntryQualityServicePure.js';
import {
  DECAY_RATE,
  DECAY_WINDOW_DAYS,
  PRUNE_THRESHOLD,
  PRUNE_AGE_DAYS,
  QUALITY_ADJUST_MIN_INJECTIONS,
  QUALITY_ADJUST_HIGH_UTILITY,
  QUALITY_ADJUST_LOW_UTILITY,
  QUALITY_ADJUST_BOOST_DELTA,
  QUALITY_ADJUST_REDUCTION_DELTA,
} from '../../config/limits.js';

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
  expect(factor, 'factor within window').toBe(1.0);
});

test('accessed exactly at DECAY_WINDOW_DAYS boundary → factor = 1.0', () => {
  const lastAccessedAt = new Date(
    now.getTime() - DECAY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const factor = computeDecayFactor({ qualityScore: 0.8, lastAccessedAt, now });
  expect(factor, 'exact boundary = no decay').toBe(1.0);
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

test('accessed far over window → factor clamps to 0.1 minimum (spec §4.1 floor)', () => {
  const lastAccessedAt = new Date(
    now.getTime() - (DECAY_WINDOW_DAYS + 1000) * 24 * 60 * 60 * 1000,
  );
  const factor = computeDecayFactor({ qualityScore: 0.8, lastAccessedAt, now });
  expect(factor, 'factor floored at 0.1 — decay alone never zeros a score').toBe(0.1);
});

// ---------------------------------------------------------------------------
// computeDecayFactor — never accessed
// ---------------------------------------------------------------------------

test('never accessed (null) → factor reflects full-window decay (floor 0.1)', () => {
  const factor = computeDecayFactor({ qualityScore: 0.8, lastAccessedAt: null, now });
  const expected = Math.max(0.1, 1 - DECAY_RATE * DECAY_WINDOW_DAYS);
  assertApprox(factor, expected, 0.001, `null → ${expected}`);
});

test('never accessed → factor is ≥ 0', () => {
  const factor = computeDecayFactor({ qualityScore: 0.8, lastAccessedAt: null, now });
  expect(factor >= 0, 'factor ≥ 0 for never-accessed').toBe(true);
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
  const result = isPruneEligible({ qualityScore: PRUNE_THRESHOLD - 0.01, createdAt: oldDate, lastAccessedAt: null, now });
  expect(result, 'old low-quality entry is prune eligible').toBe(true);
});

test('low score + fresh entry → NOT prune eligible', () => {
  const result = isPruneEligible({ qualityScore: PRUNE_THRESHOLD - 0.01, createdAt: freshDate, lastAccessedAt: null, now });
  expect(result, 'young low-quality entry is NOT pruned').toBe(false);
});

test('high score + old entry → NOT prune eligible', () => {
  const result = isPruneEligible({ qualityScore: PRUNE_THRESHOLD + 0.1, createdAt: oldDate, lastAccessedAt: null, now });
  expect(result, 'old high-quality entry is NOT pruned').toBe(false);
});

test('score exactly at threshold → NOT prune eligible (threshold is exclusive lower)', () => {
  const result = isPruneEligible({ qualityScore: PRUNE_THRESHOLD, createdAt: oldDate, lastAccessedAt: null, now });
  expect(result, 'score == PRUNE_THRESHOLD → NOT pruned').toBe(false);
});

test('score 0 + old entry → prune eligible', () => {
  const result = isPruneEligible({ qualityScore: 0, createdAt: oldDate, lastAccessedAt: null, now });
  expect(result, 'zero-score old entry is pruned').toBe(true);
});

test('entry exactly at PRUNE_AGE_DAYS → prune eligible', () => {
  const exactDate = new Date(now.getTime() - PRUNE_AGE_DAYS * 24 * 60 * 60 * 1000);
  const result = isPruneEligible({ qualityScore: 0, createdAt: exactDate, lastAccessedAt: null, now });
  expect(result, 'entry at exact PRUNE_AGE_DAYS boundary is pruned').toBe(true);
});

test('lastAccessedAt provided and recent → uses lastAccessedAt (not createdAt) for age check', () => {
  // Entry is old by createdAt but was accessed recently — not prune eligible
  const recentAccess = new Date(now.getTime() - (PRUNE_AGE_DAYS - 10) * 24 * 60 * 60 * 1000);
  const result = isPruneEligible({ qualityScore: 0, createdAt: oldDate, lastAccessedAt: recentAccess, now });
  expect(result, 'old entry accessed recently is NOT pruned (lastAccessedAt is pivot)').toBe(false);
});

// ---------------------------------------------------------------------------
// S4 — decideUtilityAdjustment
// ---------------------------------------------------------------------------

console.log('');
console.log('decideUtilityAdjustment:');

test('never injected → noop_insufficient_data', () => {
  const d = decideUtilityAdjustment({ qualityScore: 0.5, injectedCount: 0, citedCount: 0 });
  if (d.action !== 'noop_insufficient_data') throw new Error(`action=${d.action}`);
  if (d.newScore !== 0.5) throw new Error('score unchanged');
});

test('high utility (0.6 > 0.5) with 12 injections → boost', () => {
  const d = decideUtilityAdjustment({ qualityScore: 0.5, injectedCount: 12, citedCount: 8 });
  if (d.action !== 'boost') throw new Error(`action=${d.action}`);
  const expected = 0.5 + QUALITY_ADJUST_BOOST_DELTA;
  if (Math.abs(d.newScore - expected) > 1e-9) throw new Error(`score=${d.newScore}`);
});

test('low utility (0.05 < 0.1) with 12 injections → reduce', () => {
  const d = decideUtilityAdjustment({ qualityScore: 0.5, injectedCount: 12, citedCount: 0 });
  if (d.action !== 'reduce') throw new Error(`action=${d.action}`);
  const expected = 0.5 - QUALITY_ADJUST_REDUCTION_DELTA;
  if (Math.abs(d.newScore - expected) > 1e-9) throw new Error(`score=${d.newScore}`);
});

test('neutral utility (0.3) with 12 injections → noop_neutral_utility', () => {
  const d = decideUtilityAdjustment({ qualityScore: 0.5, injectedCount: 12, citedCount: 4 });
  if (d.action !== 'noop_neutral_utility') throw new Error(`action=${d.action}`);
  if (d.newScore !== 0.5) throw new Error('score unchanged');
});

test('high utility at ceiling (1.0) → noop_ceiling_or_floor', () => {
  const d = decideUtilityAdjustment({ qualityScore: 1.0, injectedCount: 20, citedCount: 18 });
  if (d.action !== 'noop_ceiling_or_floor') throw new Error(`action=${d.action}`);
  if (d.newScore !== 1.0) throw new Error(`score=${d.newScore}`);
});

test('low utility at floor (0.0) → noop_ceiling_or_floor', () => {
  const d = decideUtilityAdjustment({ qualityScore: 0.0, injectedCount: 20, citedCount: 0 });
  if (d.action !== 'noop_ceiling_or_floor') throw new Error(`action=${d.action}`);
  if (d.newScore !== 0.0) throw new Error(`score=${d.newScore}`);
});

test('low utility with only 5 injections (< MIN_INJECTIONS=10) → noop_insufficient_data', () => {
  const d = decideUtilityAdjustment({ qualityScore: 0.5, injectedCount: 5, citedCount: 0 });
  if (d.action !== 'noop_insufficient_data') throw new Error(`action=${d.action}`);
  if (d.newScore !== 0.5) throw new Error('unchanged');
});

test('high utility with 5 injections (<MIN_INJECTIONS) + rate > 0.5 → boost (early signal)', () => {
  const d = decideUtilityAdjustment({ qualityScore: 0.5, injectedCount: 5, citedCount: 4 });
  if (d.action !== 'boost') throw new Error(`action=${d.action}`);
  const expected = 0.5 + QUALITY_ADJUST_BOOST_DELTA;
  if (Math.abs(d.newScore - expected) > 1e-9) throw new Error(`score=${d.newScore}`);
});

test('boost caps at 1.0', () => {
  const d = decideUtilityAdjustment({ qualityScore: 0.98, injectedCount: 20, citedCount: 18 });
  if (d.action !== 'boost') throw new Error(`action=${d.action}`);
  if (d.newScore !== 1.0) throw new Error(`score=${d.newScore}, expected 1.0 cap`);
});

test('reduce floors at 0.0', () => {
  const d = decideUtilityAdjustment({ qualityScore: 0.03, injectedCount: 20, citedCount: 0 });
  if (d.action !== 'reduce') throw new Error(`action=${d.action}`);
  if (d.newScore !== 0.0) throw new Error(`score=${d.newScore}, expected 0.0 floor`);
});

test('utilityRate computed correctly', () => {
  const d = decideUtilityAdjustment({ qualityScore: 0.5, injectedCount: 20, citedCount: 7 });
  if (Math.abs(d.utilityRate - 0.35) > 1e-9) throw new Error(`utilityRate=${d.utilityRate}`);
});

// ---------------------------------------------------------------------------
// Hermes Tier 1 Phase B §6.6 — per-entryType half-life branching.
// ---------------------------------------------------------------------------
//
// `computeDecayFactor` now branches on `entryType`:
//   - known entryType in HALF_LIFE_DAYS → exponential half-life decay,
//     factor = 0.5 at T = halfLife
//   - unknown / missing → today's linear DECAY_RATE formula (§6.6
//     "Default keeps today's single rate")

import { HALF_LIFE_DAYS } from '../../services/memoryEntryQualityServicePure.js';

console.log('');
console.log('Phase B §6.6 — per-entryType half-life decay:');

const MS_PER_DAY_PHASE_B = 1000 * 60 * 60 * 24;
const BASE_NOW = new Date('2026-01-01T00:00:00Z');

function daysAgo(days: number): Date {
  return new Date(BASE_NOW.getTime() - days * MS_PER_DAY_PHASE_B);
}

for (const [entryType, halfLife] of Object.entries(HALF_LIFE_DAYS) as [
  'observation' | 'decision' | 'preference' | 'issue' | 'pattern',
  number,
][]) {
  test(`${entryType} decays to factor 0.5 at T=${halfLife} days`, () => {
    const factor = computeDecayFactor({
      qualityScore: 1.0,
      lastAccessedAt: daysAgo(halfLife),
      now: BASE_NOW,
      entryType,
    });
    if (Math.abs(factor - 0.5) > 1e-6) {
      throw new Error(`expected factor ≈ 0.5, got ${factor}`);
    }
  });

  test(`${entryType} decays to ~0.25 at T=2×halfLife (${halfLife * 2} days)`, () => {
    const factor = computeDecayFactor({
      qualityScore: 1.0,
      lastAccessedAt: daysAgo(halfLife * 2),
      now: BASE_NOW,
      entryType,
    });
    if (Math.abs(factor - 0.25) > 1e-6) {
      throw new Error(`expected factor ≈ 0.25, got ${factor}`);
    }
  });

  test(`${entryType} factor at T=0 is 1.0 (no decay)`, () => {
    const factor = computeDecayFactor({
      qualityScore: 1.0,
      lastAccessedAt: BASE_NOW,
      now: BASE_NOW,
      entryType,
    });
    if (Math.abs(factor - 1.0) > 1e-9) {
      throw new Error(`expected factor 1.0, got ${factor}`);
    }
  });
}

test('factor never negative, even at extreme age', () => {
  const factor = computeDecayFactor({
    qualityScore: 1.0,
    lastAccessedAt: daysAgo(1_000_000),
    now: BASE_NOW,
    entryType: 'observation',
  });
  if (factor < 0) throw new Error(`factor was negative: ${factor}`);
  if (factor > 1) throw new Error(`factor exceeded 1: ${factor}`);
});

test('observation (7-day) decays faster than preference (30-day) at same T', () => {
  const o = computeDecayFactor({
    qualityScore: 1.0,
    lastAccessedAt: daysAgo(14),
    now: BASE_NOW,
    entryType: 'observation',
  });
  const p = computeDecayFactor({
    qualityScore: 1.0,
    lastAccessedAt: daysAgo(14),
    now: BASE_NOW,
    entryType: 'preference',
  });
  if (o >= p) {
    throw new Error(`observation (${o}) should decay faster than preference (${p})`);
  }
});

test('default branch (no entryType) falls back to linear DECAY_RATE — within window = 1.0', () => {
  const factor = computeDecayFactor({
    qualityScore: 1.0,
    lastAccessedAt: daysAgo(DECAY_WINDOW_DAYS / 2),
    now: BASE_NOW,
  });
  if (Math.abs(factor - 1.0) > 1e-9) {
    throw new Error(`default within-window factor should be 1.0, got ${factor}`);
  }
});

test('default branch at DECAY_WINDOW+5 days uses linear formula', () => {
  const factor = computeDecayFactor({
    qualityScore: 1.0,
    lastAccessedAt: daysAgo(DECAY_WINDOW_DAYS + 5),
    now: BASE_NOW,
  });
  const expected = Math.max(0.1, 1 - DECAY_RATE * 5);
  if (Math.abs(factor - expected) > 1e-9) {
    throw new Error(`expected linear ${expected}, got ${factor}`);
  }
});

test('half-life branch on null lastAccessedAt uses DECAY_WINDOW_DAYS as baseline', () => {
  // Null lastAccessed is treated as exactly DECAY_WINDOW_DAYS ago so the
  // branch doesn't crash. Pinning so future refactors don't silently
  // change the starting point.
  const factor = computeDecayFactor({
    qualityScore: 1.0,
    lastAccessedAt: null,
    now: BASE_NOW,
    entryType: 'observation',
  });
  const expected = Math.pow(0.5, DECAY_WINDOW_DAYS / HALF_LIFE_DAYS.observation);
  if (Math.abs(factor - expected) > 1e-9) {
    throw new Error(`expected ${expected}, got ${factor}`);
  }
});

console.log('');
console.log('');
