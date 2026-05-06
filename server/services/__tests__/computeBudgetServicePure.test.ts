/**
 * computeBudgetServicePure.test.ts — Pure-unit tests for the Compute Budget
 * pure helpers.
 *
 * Spec: tasks/builds/agentic-commerce/spec.md §2 (vocabulary lock),
 * plan §4 Chunk 1 (pure extraction).
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/computeBudgetServicePure.test.ts
 */
import { expect, test } from 'vitest';
import {
  projectCostCents,
  compareToLimit,
  ComputeBudgetExceededError,
  isComputeBudgetExceededError,
} from '../computeBudgetServicePure.js';

// --- projectCostCents ---

test('projectCostCents: zero delta leaves current unchanged', () => {
  expect(projectCostCents(500, 0)).toBe(500);
});

test('projectCostCents: adds delta to current', () => {
  expect(projectCostCents(300, 200)).toBe(500);
});

test('projectCostCents: both zero yields zero', () => {
  expect(projectCostCents(0, 0)).toBe(0);
});

// --- compareToLimit ---

test('compareToLimit: within when projected < limit', () => {
  expect(compareToLimit(80, 100)).toBe('within');
});

test('compareToLimit: within when projected equals limit', () => {
  expect(compareToLimit(100, 100)).toBe('within');
});

test('compareToLimit: exceeded when projected > limit', () => {
  expect(compareToLimit(101, 100)).toBe('exceeded');
});

test('compareToLimit: zero limit means no cap — always within', () => {
  expect(compareToLimit(99999, 0)).toBe('within');
});

test('compareToLimit: large numbers', () => {
  expect(compareToLimit(1_000_001, 1_000_000)).toBe('exceeded');
  expect(compareToLimit(1_000_000, 1_000_000)).toBe('within');
});

// --- ComputeBudgetExceededError ---

test('ComputeBudgetExceededError: has correct name and code', () => {
  const err = new ComputeBudgetExceededError('monthly_org', 10000, 10001, 'org-1');
  expect(err.name).toBe('ComputeBudgetExceededError');
  expect(err.code).toBe('COMPUTE_BUDGET_EXCEEDED');
  expect(err).toBeInstanceOf(ComputeBudgetExceededError);
  expect(err).toBeInstanceOf(Error);
});

test('ComputeBudgetExceededError: stores fields correctly', () => {
  const err = new ComputeBudgetExceededError('run_cost', 500, 600, 'run-abc');
  expect(err.limitType).toBe('run_cost');
  expect(err.limitCents).toBe(500);
  expect(err.projectedCents).toBe(600);
  expect(err.entityId).toBe('run-abc');
});

test('ComputeBudgetExceededError: message contains limit type and values', () => {
  const err = new ComputeBudgetExceededError('daily_subaccount', 200, 300, 'sub-1');
  expect(err.message).toContain('daily_subaccount');
  expect(err.message).toContain('200');
  expect(err.message).toContain('300');
});

// --- isComputeBudgetExceededError ---

test('isComputeBudgetExceededError: true for ComputeBudgetExceededError instance', () => {
  const err = new ComputeBudgetExceededError('run_cost', 100, 200, 'x');
  expect(isComputeBudgetExceededError(err)).toBe(true);
});

test('isComputeBudgetExceededError: true for plain-object 402 shape with correct code', () => {
  const shape = { statusCode: 402, code: 'COMPUTE_BUDGET_EXCEEDED' };
  expect(isComputeBudgetExceededError(shape)).toBe(true);
});

test('isComputeBudgetExceededError: false for 402 with wrong code', () => {
  const shape = { statusCode: 402, code: 'RATE_LIMITED' };
  expect(isComputeBudgetExceededError(shape)).toBe(false);
});

test('isComputeBudgetExceededError: false for non-budget error', () => {
  expect(isComputeBudgetExceededError(new Error('something else'))).toBe(false);
});

test('isComputeBudgetExceededError: false for null', () => {
  expect(isComputeBudgetExceededError(null)).toBe(false);
});

test('isComputeBudgetExceededError: false for undefined', () => {
  expect(isComputeBudgetExceededError(undefined)).toBe(false);
});
