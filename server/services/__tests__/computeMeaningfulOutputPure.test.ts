/**
 * computeMeaningfulOutputPure.test.ts
 *
 * Pure-function tests for F22 "meaningful output" definition.
 * Tests the computeMeaningfulOutputPure helper from agentRunFinalizationServicePure.
 * Does NOT require a real Postgres instance.
 *
 * Run via: npx tsx server/services/__tests__/computeMeaningfulOutputPure.test.ts
 */

import { computeMeaningfulOutputPure } from '../agentRunFinalizationServicePure.js';

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

console.log('\ncomputeMeaningfulOutputPure — F22 meaningful output tests\n');

test('status not completed → false (regardless of counts)', () => {
  assert(!computeMeaningfulOutputPure({ status: 'failed', actionProposedCount: 5, memoryBlockWrittenCount: 5 }), 'failed run should not be meaningful');
  assert(!computeMeaningfulOutputPure({ status: 'timeout', actionProposedCount: 1, memoryBlockWrittenCount: 0 }), 'timeout run should not be meaningful');
  assert(!computeMeaningfulOutputPure({ status: 'running', actionProposedCount: 0, memoryBlockWrittenCount: 1 }), 'running run should not be meaningful');
});

test('completed + 0 actions + 0 memory → false', () => {
  const result = computeMeaningfulOutputPure({ status: 'completed', actionProposedCount: 0, memoryBlockWrittenCount: 0 });
  assert(!result, 'zero-output completed run should not be meaningful');
});

test('completed + 1 action + 0 memory → true', () => {
  const result = computeMeaningfulOutputPure({ status: 'completed', actionProposedCount: 1, memoryBlockWrittenCount: 0 });
  assert(result, 'one action proposed should be meaningful');
});

test('completed + 0 actions + 1 memory → true', () => {
  const result = computeMeaningfulOutputPure({ status: 'completed', actionProposedCount: 0, memoryBlockWrittenCount: 1 });
  assert(result, 'one memory block written should be meaningful');
});

test('completed + many actions + many memory → true', () => {
  const result = computeMeaningfulOutputPure({ status: 'completed', actionProposedCount: 10, memoryBlockWrittenCount: 5 });
  assert(result, 'many actions and memory writes should be meaningful');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
