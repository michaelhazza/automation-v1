// Tests for computeOutputEntropy and meanEntropy — pure functions.
// Run: npx tsx server/services/systemMonitor/baselines/__tests__/computeOutputEntropyPure.test.ts

import { computeOutputEntropy, meanEntropy } from '../computeOutputEntropyPure.js';

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

// ── computeOutputEntropy ───────────────────────────────────────────────────────

console.log('\n--- computeOutputEntropy ---');

test('empty string returns 0', () => {
  assert(computeOutputEntropy('') === 0, 'should be 0');
});

test('single character returns 0', () => {
  assert(computeOutputEntropy('aaaa') === 0, 'uniform single char: entropy = 0');
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
  assert(high > low, 'more uniform distribution → higher entropy');
});

test('repeating output (collapse signal) has near-zero entropy', () => {
  const s = 'The answer is no. '.repeat(200);
  assert(computeOutputEntropy(s) < 3.5, 'repetitive output has low entropy');
});

test('natural language text has entropy > 3 bits', () => {
  const s = 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.';
  assert(computeOutputEntropy(s) > 3, 'natural text has moderately high entropy');
});

// ── meanEntropy ───────────────────────────────────────────────────────────────

console.log('\n--- meanEntropy ---');

test('empty samples returns 0', () => {
  assert(meanEntropy([]) === 0, 'no samples → 0');
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
  assert(m > computeOutputEntropy(low) && m < computeOutputEntropy(high), 'mean is between');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
if (failures.length > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
}
console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
