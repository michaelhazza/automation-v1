/**
 * ruleAutoDeprecateJobPure.test.ts
 *
 * Pure-function tests for ruleAutoDeprecateJob.
 * Tests the classifyMemoryBlock helper that encapsulates the decay arithmetic.
 * Does NOT require a real Postgres instance.
 *
 * Run via: npx tsx server/jobs/__tests__/ruleAutoDeprecateJobPure.test.ts
 */

import { classifyMemoryBlock } from '../ruleAutoDeprecateJob.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
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

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

console.log('\nruleAutoDeprecateJob — pure-function tests\n');

// ---------------------------------------------------------------------------
// classifyMemoryBlock
// ---------------------------------------------------------------------------

const DECAY_RATE = 0.02;
const AUTO_DEPRECATE_THRESHOLD = 0.15;
const AUTO_DEPRECATE_DAYS = 14;

test('high-quality block (0.9), recent update → decay (0.9 - 0.02 = 0.88)', () => {
  const result = classifyMemoryBlock(0.9, 1);
  assert(result === 'decay', `Expected 'decay', got '${result}'`);
});

test('block at exactly decay boundary (score 0.17 → 0.15 after decay, days < 14) → decay', () => {
  const score = 0.17; // 0.17 - 0.02 = 0.15, which is NOT < 0.15 (threshold is strict <)
  const result = classifyMemoryBlock(score, 10);
  assert(result === 'decay', `Expected 'decay', got '${result}'`);
});

test('block at score 0.16 → 0.14 after decay, days < 14 → decay not auto_deprecate', () => {
  const result = classifyMemoryBlock(0.16, 10);
  assert(result === 'decay', `Expected 'decay', got '${result}'`);
});

test('block at score 0.16, days >= 14 → auto_deprecate', () => {
  const result = classifyMemoryBlock(0.16, 14);
  assert(result === 'auto_deprecate', `Expected 'auto_deprecate', got '${result}'`);
});

test('block at score 0.16, days exactly 14 → auto_deprecate (boundary inclusive)', () => {
  const result = classifyMemoryBlock(0.16, 14);
  assert(result === 'auto_deprecate', `Expected 'auto_deprecate', got '${result}'`);
});

test('block at score 0.16, days = 13.9 → decay (not yet auto_deprecate)', () => {
  const result = classifyMemoryBlock(0.16, 13.9);
  assert(result === 'decay', `Expected 'decay', got '${result}'`);
});

test('very low quality, long stale → auto_deprecate', () => {
  const result = classifyMemoryBlock(0.1, 30);
  assert(result === 'auto_deprecate', `Expected 'auto_deprecate', got '${result}'`);
});

test('score 0.0 (floor), days >= 14 → auto_deprecate (0 < 0.15 and stale)', () => {
  // newScore = max(0, 0 - 0.02) = 0 < 0.15 threshold, and days >= 14
  const result = classifyMemoryBlock(0, 100);
  assert(result === 'auto_deprecate', `Expected 'auto_deprecate' for floored+stale block, got '${result}'`);
});

test('score 1.0, recent → decay (1.0 - 0.02 = 0.98)', () => {
  const result = classifyMemoryBlock(1.0, 0);
  assert(result === 'decay', `Expected 'decay', got '${result}'`);
});

test('score 0.0 (floor), days < 14 → no_change (already at floor, not yet stale)', () => {
  // max(0, 0 - 0.02) = 0 = qualityScore; days < 14 → auto_deprecate check fails
  const result = classifyMemoryBlock(0, 10);
  assert(result === 'no_change', `Expected 'no_change' for floored score with days < 14, got '${result}'`);
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
