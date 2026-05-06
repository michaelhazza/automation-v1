/**
 * orchestratorMilestoneEmitterPure.test.ts
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/orchestratorMilestoneEmitterPure.test.ts
 */

import { expect, test } from 'vitest';
import { classifyAsMilestone } from '../orchestratorMilestoneEmitterPure.js';

test('classifies file creation as file_produced', () => {
  const result = classifyAsMilestone('Created report.pdf');
  expect(result.isMilestone).toBe(true);
  expect(result.kind).toBe('file_produced');
  expect(result.summary).toBe('Created report.pdf');
});

test('classifies approval as decision_made', () => {
  const result = classifyAsMilestone('Approved the proposal');
  expect(result.isMilestone).toBe(true);
  expect(result.kind).toBe('decision_made');
});

test('classifies handoff as handoff_complete', () => {
  const result = classifyAsMilestone('Handed off to accounting team');
  expect(result.isMilestone).toBe(true);
  expect(result.kind).toBe('handoff_complete');
});

test('returns isMilestone=false for non-milestone description', () => {
  const result = classifyAsMilestone('Just logging...');
  expect(result.isMilestone).toBe(false);
  expect(result.kind).toBeUndefined();
  expect(result.summary).toBe('Just logging...');
});

test('classifies plan restructure as plan_changed', () => {
  const result = classifyAsMilestone('Restructured the project plan');
  expect(result.isMilestone).toBe(true);
  expect(result.kind).toBe('plan_changed');
});
