/**
 * subaccountNoRoot.test.ts — pure-function tests for
 * findSubaccountsWithNoRoot().
 *
 * Runnable via:
 *   npx tsx server/services/workspaceHealth/detectors/__tests__/subaccountNoRoot.test.ts
 */

import { expect, test } from 'vitest';
import { findSubaccountsWithNoRoot } from '../subaccountNoRootPure.js';

function assertEqual<T>(actual: T, expected: T, msg?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('all subaccounts have roots → empty', () => {
  const result = findSubaccountsWithNoRoot(['sa-1', 'sa-2'], ['sa-1', 'sa-2']);
  expect(result).toEqual([]);
});

test('one subaccount with root, one without → one returned', () => {
  const result = findSubaccountsWithNoRoot(['sa-1', 'sa-2'], ['sa-1']);
  expect(result.length).toBe(1);
  expect(result[0] === 'sa-2', 'wrong subaccountId returned').toBeTruthy();
});

test('multiple subaccounts, none with roots → all returned', () => {
  const all = ['sa-a', 'sa-b', 'sa-c'];
  const result = findSubaccountsWithNoRoot(all, []);
  expect(result.length).toBe(3);
  expect(all.every((id) => result.includes(id)), 'not all subaccountIds returned').toBeTruthy();
});

test('inactive roots do not count (pure input: empty subaccountsWithRoot)', () => {
  // Inactive roots are filtered by the caller before passing to this function.
  // Simulated here by passing an empty subaccountsWithRoot even though there
  // is a "root" that would count if it were active.
  const result = findSubaccountsWithNoRoot(['sa-1'], []);
  expect(result).toEqual(['sa-1']);
});

test('no subaccounts → empty', () => {
  const result = findSubaccountsWithNoRoot([], []);
  expect(result).toEqual([]);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
