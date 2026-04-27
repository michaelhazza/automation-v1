// Tests for computeKLDivergence and buildToolDistribution — pure functions.
// Run: npx tsx server/services/systemMonitor/baselines/__tests__/computeKLDivergencePure.test.ts

import { computeKLDivergence, buildToolDistribution } from '../computeKLDivergencePure.js';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`  ✗ ${name}: ${msg}`);
    console.log(`  ✗ ${name}: ${msg}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

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
  assert(computeKLDivergence(p, q) > 10, 'disjoint distributions diverge greatly');
});

test('partial overlap → intermediate divergence', () => {
  const p = { a: 0.7, b: 0.3 };
  const q = { a: 0.5, b: 0.5 };
  const kl = computeKLDivergence(p, q);
  assert(kl > 0 && kl < 2, 'intermediate divergence in range (0,2)');
});

test('result is non-negative', () => {
  const p = { x: 3, y: 1 };
  const q = { x: 1, y: 3 };
  assert(computeKLDivergence(p, q) >= 0, 'KL divergence is always >= 0');
});

test('extra key in Q not in P → handled without error', () => {
  const p = { a: 1 };
  const q = { a: 1, b: 1 };
  const kl = computeKLDivergence(p, q);
  assert(kl >= 0, 'handles extra Q key gracefully');
});

test('throws on zero-mass distribution', () => {
  let threw = false;
  try {
    computeKLDivergence({ a: 0 }, { a: 1 });
  } catch {
    threw = true;
  }
  assert(threw, 'should throw on zero-mass P');
});

// ── buildToolDistribution ──────────────────────────────────────────────────────

console.log('\n--- buildToolDistribution ---');

test('empty list returns empty distribution', () => {
  const d = buildToolDistribution([]);
  assert(Object.keys(d).length === 0, 'empty');
});

test('counts each tool correctly', () => {
  const d = buildToolDistribution(['read_agent_run', 'write_diagnosis', 'read_agent_run']);
  assert(d['read_agent_run'] === 2, 'count 2');
  assert(d['write_diagnosis'] === 1, 'count 1');
});

test('resulting distribution is usable with computeKLDivergence', () => {
  const baseline = buildToolDistribution(['read', 'write', 'read', 'write', 'read']);
  const current = buildToolDistribution(['read', 'read', 'read', 'read', 'write']);
  const kl = computeKLDivergence(current, baseline);
  assert(kl >= 0, 'valid divergence');
  // current shifts toward read-heavy — should show some divergence from baseline
  assert(kl > 0, 'drift detected when distribution changes');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
if (failures.length > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
}
console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
