/**
 * subaccountMultipleRoots.test.ts — pure-function tests for
 * findSubaccountsWithMultipleRoots().
 *
 * Runnable via:
 *   npx tsx server/services/workspaceHealth/detectors/__tests__/subaccountMultipleRoots.test.ts
 */

import { findSubaccountsWithMultipleRoots } from '../subaccountMultipleRootsPure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
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

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertEqual<T>(actual: T, expected: T, msg?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('zero rows → no findings', () => {
  const result = findSubaccountsWithMultipleRoots([]);
  assertEqual(result, []);
});

test('one subaccount with one root → no findings', () => {
  const result = findSubaccountsWithMultipleRoots([
    { subaccountId: 'sa-1', count: 1 },
  ]);
  assertEqual(result, []);
});

test('one subaccount with two roots → one finding returned', () => {
  const result = findSubaccountsWithMultipleRoots([
    { subaccountId: 'sa-1', count: 2 },
  ]);
  assertEqual(result.length, 1);
  assert(result[0].subaccountId === 'sa-1', 'wrong subaccountId');
  assert(result[0].count === 2, 'wrong count');
});

test('multiple subaccounts, only one violating → only that one returned', () => {
  const result = findSubaccountsWithMultipleRoots([
    { subaccountId: 'sa-ok', count: 1 },
    { subaccountId: 'sa-bad', count: 3 },
  ]);
  assertEqual(result.length, 1);
  assert(result[0].subaccountId === 'sa-bad', 'wrong subaccountId');
});

test('multiple subaccounts, all violating → all returned', () => {
  const input = [
    { subaccountId: 'sa-a', count: 2 },
    { subaccountId: 'sa-b', count: 5 },
    { subaccountId: 'sa-c', count: 3 },
  ];
  const result = findSubaccountsWithMultipleRoots(input);
  assertEqual(result.length, 3);
  assert(result.every((r) => r.count > 1), 'all should have count > 1');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
console.log(`[subaccountMultipleRoots] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
