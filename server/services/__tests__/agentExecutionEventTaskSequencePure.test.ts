/**
 * agentExecutionEventTaskSequencePure.test.ts
 *
 * Pure function tests for task-scoped event sequence allocation.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/agentExecutionEventTaskSequencePure.test.ts
 */

import { allocateTaskSequence } from '../agentExecutionEventTaskSequencePure.js';

// ---------------------------------------------------------------------------
// Minimal test runner (no framework dependency — runs via npx tsx)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL  ${label}`);
    console.error(`        ${(err as Error).message}`);
    failed += 1;
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('');
console.log('agentExecutionEventTaskSequencePure');
console.log('');

test('first allocation from 0 returns allocated=1, newNextSeq=1', () => {
  const result = allocateTaskSequence(0);
  assertEqual(result.allocated, 1, 'allocated');
  assertEqual(result.newNextSeq, 1, 'newNextSeq');
});

test('subsequent allocation from 1 returns allocated=2, newNextSeq=2', () => {
  const result = allocateTaskSequence(1);
  assertEqual(result.allocated, 2, 'allocated');
  assertEqual(result.newNextSeq, 2, 'newNextSeq');
});

test('large sequence number allocates correctly', () => {
  const result = allocateTaskSequence(999);
  assertEqual(result.allocated, 1000, 'allocated');
  assertEqual(result.newNextSeq, 1000, 'newNextSeq');
});

test('allocated === newNextSeq invariant holds', () => {
  for (const n of [0, 1, 5, 42, 100, 9999]) {
    const result = allocateTaskSequence(n);
    if (result.allocated !== result.newNextSeq) {
      throw new Error(
        `invariant violated for n=${n}: allocated=${result.allocated} !== newNextSeq=${result.newNextSeq}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');

if (failed > 0) {
  process.exit(1);
}
