// Tests for computeKLDivergence and buildToolDistribution — pure functions.
// Run: npx tsx server/services/systemMonitor/baselines/__tests__/computeKLDivergencePure.test.ts

import { expect, test } from 'vitest';
import { computeKLDivergence, buildToolDistribution } from '../computeKLDivergencePure.js';

const failures: string[] = [];

function assertApprox(actual: number, expected: number, tol: number, label: string): void {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${label}: expected ≈${expected} (±${tol}), got ${actual}`);
  }
}

// ── computeKLDivergence ────────────────────────────────────────────────────────

console.log('\n--- computeKLDivergence ---');

test('identical distributions → divergence ≈ 0', () => {
  const p = { a: 0.5, b: 0.5 };
  const q = { a: 0.5, b: 0.5 };
  assertApprox(computeKLDivergence(p, q), 0, 0.001, 'identical');
});

test('uniform vs uniform with different scale → ≈ 0 (normalisation)', () => {
  const p = { a: 10, b: 10 };
  const q = { a: 1, b: 1 };
  assertApprox(computeKLDivergence(p, q), 0, 0.001, 'different scale same shape');
});

test('completely shifted distribution → high divergence', () => {
  const p = { a: 1, b: 0 };
  const q = { a: 0, b: 1 };
  // D_KL(P||Q) should be very large when P has mass where Q has none
  expect(computeKLDivergence(p, q) > 10, 'disjoint distributions diverge greatly').toBeTruthy();
});

test('partial overlap → intermediate divergence', () => {
  const p = { a: 0.7, b: 0.3 };
  const q = { a: 0.5, b: 0.5 };
  const kl = computeKLDivergence(p, q);
  expect(kl > 0 && kl < 2, 'intermediate divergence in range (0,2)').toBeTruthy();
});

test('result is non-negative', () => {
  const p = { x: 3, y: 1 };
  const q = { x: 1, y: 3 };
  expect(computeKLDivergence(p, q) >= 0, 'KL divergence is always >= 0').toBeTruthy();
});

test('extra key in Q not in P → handled without error', () => {
  const p = { a: 1 };
  const q = { a: 1, b: 1 };
  const kl = computeKLDivergence(p, q);
  expect(kl >= 0, 'handles extra Q key gracefully').toBeTruthy();
});

test('throws on zero-mass distribution', () => {
  let threw = false;
  try {
    computeKLDivergence({ a: 0 }, { a: 1 });
  } catch {
    threw = true;
  }
  expect(threw, 'should throw on zero-mass P').toBeTruthy();
});

// ── buildToolDistribution ──────────────────────────────────────────────────────

console.log('\n--- buildToolDistribution ---');

test('empty list returns empty distribution', () => {
  const d = buildToolDistribution([]);
  expect(Object.keys(d).length === 0, 'empty').toBeTruthy();
});

test('counts each tool correctly', () => {
  const d = buildToolDistribution(['read_agent_run', 'write_diagnosis', 'read_agent_run']);
  expect(d['read_agent_run'] === 2, 'count 2').toBeTruthy();
  expect(d['write_diagnosis'] === 1, 'count 1').toBeTruthy();
});

test('resulting distribution is usable with computeKLDivergence', () => {
  const baseline = buildToolDistribution(['read', 'write', 'read', 'write', 'read']);
  const current = buildToolDistribution(['read', 'read', 'read', 'read', 'write']);
  const kl = computeKLDivergence(current, baseline);
  expect(kl >= 0, 'valid divergence').toBeTruthy();
  // current shifts toward read-heavy — should show some divergence from baseline
  expect(kl > 0, 'drift detected when distribution changes').toBeTruthy();
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
if (failures.length > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
}
