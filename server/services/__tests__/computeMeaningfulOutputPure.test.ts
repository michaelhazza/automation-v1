/**
 * computeMeaningfulOutputPure.test.ts
 *
 * Pure-function tests for F22 "meaningful output" definition.
 * Tests the computeMeaningfulOutputPure helper from agentRunFinalizationServicePure.
 * Does NOT require a real Postgres instance.
 *
 * Run via: npx tsx server/services/__tests__/computeMeaningfulOutputPure.test.ts
 */

import { expect, test } from 'vitest';
import { computeMeaningfulOutputPure } from '../agentRunFinalizationServicePure.js';

console.log('\ncomputeMeaningfulOutputPure — F22 meaningful output tests\n');

test('status not completed → false (regardless of counts)', () => {
  expect(!computeMeaningfulOutputPure({ status: 'failed', actionProposedCount: 5, memoryBlockWrittenCount: 5 }), 'failed run should not be meaningful').toBeTruthy();
  expect(!computeMeaningfulOutputPure({ status: 'timeout', actionProposedCount: 1, memoryBlockWrittenCount: 0 }), 'timeout run should not be meaningful').toBeTruthy();
  expect(!computeMeaningfulOutputPure({ status: 'running', actionProposedCount: 0, memoryBlockWrittenCount: 1 }), 'running run should not be meaningful').toBeTruthy();
});

test('completed + 0 actions + 0 memory → false', () => {
  const result = computeMeaningfulOutputPure({ status: 'completed', actionProposedCount: 0, memoryBlockWrittenCount: 0 });
  expect(!result, 'zero-output completed run should not be meaningful').toBeTruthy();
});

test('completed + 1 action + 0 memory → true', () => {
  const result = computeMeaningfulOutputPure({ status: 'completed', actionProposedCount: 1, memoryBlockWrittenCount: 0 });
  expect(result, 'one action proposed should be meaningful').toBeTruthy();
});

test('completed + 0 actions + 1 memory → true', () => {
  const result = computeMeaningfulOutputPure({ status: 'completed', actionProposedCount: 0, memoryBlockWrittenCount: 1 });
  expect(result, 'one memory block written should be meaningful').toBeTruthy();
});

test('completed + many actions + many memory → true', () => {
  const result = computeMeaningfulOutputPure({ status: 'completed', actionProposedCount: 10, memoryBlockWrittenCount: 5 });
  expect(result, 'many actions and memory writes should be meaningful').toBeTruthy();
});
