// Tests for computeOutputEntropy and meanEntropy — pure functions.
// Run: npx tsx server/services/systemMonitor/baselines/__tests__/computeOutputEntropyPure.test.ts

import { expect, test } from 'vitest';
import { computeOutputEntropy, meanEntropy } from '../computeOutputEntropyPure.js';

const failures: string[] = [];

function assertApprox(actual: number, expected: number, tol: number, label: string): void {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${label}: expected ≈${expected} (±${tol}), got ${actual}`);
  }
}

// ── computeOutputEntropy ───────────────────────────────────────────────────────

console.log('\n--- computeOutputEntropy ---');

test('empty string returns 0', () => {
  expect(computeOutputEntropy('') === 0, 'should be 0').toBeTruthy();
});

test('single character returns 0', () => {
  expect(computeOutputEntropy('aaaa') === 0, 'uniform single char: entropy = 0').toBeTruthy();
});

test('two equally likely characters → entropy = 1 bit', () => {
  const s = 'ab'.repeat(500);
  assertApprox(computeOutputEntropy(s), 1.0, 0.01, 'binary uniform');
});

test('four equally likely characters → entropy = 2 bits', () => {
  const s = 'abcd'.repeat(250);
  assertApprox(computeOutputEntropy(s), 2.0, 0.01, 'four-char uniform');
});

test('entropy increases with more distinct characters', () => {
  const low = computeOutputEntropy('aaab');
  const high = computeOutputEntropy('abcd'.repeat(50));
  expect(high > low, 'more uniform distribution → higher entropy').toBeTruthy();
});

test('repeating output (collapse signal) has near-zero entropy', () => {
  const s = 'The answer is no. '.repeat(200);
  expect(computeOutputEntropy(s) < 3.5, 'repetitive output has low entropy').toBeTruthy();
});

test('natural language text has entropy > 3 bits', () => {
  const s = 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.';
  expect(computeOutputEntropy(s) > 3, 'natural text has moderately high entropy').toBeTruthy();
});

// ── meanEntropy ───────────────────────────────────────────────────────────────

console.log('\n--- meanEntropy ---');

test('empty samples returns 0', () => {
  expect(meanEntropy([]) === 0, 'no samples → 0').toBeTruthy();
});

test('single sample returns its entropy', () => {
  const s = 'ab'.repeat(100);
  const single = meanEntropy([s]);
  assertApprox(single, computeOutputEntropy(s), 0.001, 'single sample');
});

test('mean of two uniform samples is 1.0', () => {
  const s = 'ab'.repeat(100);
  assertApprox(meanEntropy([s, s]), 1.0, 0.01, 'mean of two equal samples');
});

test('mean of high and low entropy samples is in between', () => {
  const high = 'abcdefgh'.repeat(50);
  const low = 'aaaa'.repeat(50);
  const m = meanEntropy([high, low]);
  expect(m > computeOutputEntropy(low) && m < computeOutputEntropy(high), 'mean is between').toBeTruthy();
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
if (failures.length > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
}
