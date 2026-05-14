/**
 * subaccountMultipleRoots.test.ts — pure-function tests for
 * findSubaccountsWithMultipleRoots().
 *
 * Runnable via:
 *   npx tsx server/services/workspaceHealth/detectors/__tests__/subaccountMultipleRoots.test.ts
 */

import { expect, test } from 'vitest';
import { findSubaccountsWithMultipleRoots } from '../subaccountMultipleRootsPure.js';

function assertEqual<T>(actual: T, expected: T, msg?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('zero rows → no findings', () => {
  const result = findSubaccountsWithMultipleRoots([]);
  expect(result).toEqual([]);
});

test('one subaccount with one root → no findings', () => {
  const result = findSubaccountsWithMultipleRoots([
    { subaccountId: 'sa-1', count: 1 },
  ]);
  expect(result).toEqual([]);
});

test('one subaccount with two roots → one finding returned', () => {
  const result = findSubaccountsWithMultipleRoots([
    { subaccountId: 'sa-1', count: 2 },
  ]);
  expect(result.length).toBe(1);
  expect(result[0].subaccountId === 'sa-1', 'wrong subaccountId').toBeTruthy();
  expect(result[0].count === 2, 'wrong count').toBeTruthy();
});

test('multiple subaccounts, only one violating → only that one returned', () => {
  const result = findSubaccountsWithMultipleRoots([
    { subaccountId: 'sa-ok', count: 1 },
    { subaccountId: 'sa-bad', count: 3 },
  ]);
  expect(result.length).toBe(1);
  expect(result[0].subaccountId === 'sa-bad', 'wrong subaccountId').toBeTruthy();
});

test('multiple subaccounts, all violating → all returned', () => {
  const input = [
    { subaccountId: 'sa-a', count: 2 },
    { subaccountId: 'sa-b', count: 5 },
    { subaccountId: 'sa-c', count: 3 },
  ];
  const result = findSubaccountsWithMultipleRoots(input);
  expect(result.length).toBe(3);
  expect(result.every((r) => r.count > 1), 'all should have count > 1').toBeTruthy();
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
