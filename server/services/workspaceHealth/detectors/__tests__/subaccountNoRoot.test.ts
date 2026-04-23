/**
 * subaccountNoRoot.test.ts — pure-function tests for
 * findSubaccountsWithNoRoot().
 *
 * Runnable via:
 *   npx tsx server/services/workspaceHealth/detectors/__tests__/subaccountNoRoot.test.ts
 */

import { findSubaccountsWithNoRoot } from '../subaccountNoRootPure.js';

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

test('all subaccounts have roots → empty', () => {
  const result = findSubaccountsWithNoRoot(['sa-1', 'sa-2'], ['sa-1', 'sa-2']);
  assertEqual(result, []);
});

test('one subaccount with root, one without → one returned', () => {
  const result = findSubaccountsWithNoRoot(['sa-1', 'sa-2'], ['sa-1']);
  assertEqual(result.length, 1);
  assert(result[0] === 'sa-2', 'wrong subaccountId returned');
});

test('multiple subaccounts, none with roots → all returned', () => {
  const all = ['sa-a', 'sa-b', 'sa-c'];
  const result = findSubaccountsWithNoRoot(all, []);
  assertEqual(result.length, 3);
  assert(all.every((id) => result.includes(id)), 'not all subaccountIds returned');
});

test('inactive roots do not count (pure input: empty subaccountsWithRoot)', () => {
  // Inactive roots are filtered by the caller before passing to this function.
  // Simulated here by passing an empty subaccountsWithRoot even though there
  // is a "root" that would count if it were active.
  const result = findSubaccountsWithNoRoot(['sa-1'], []);
  assertEqual(result, ['sa-1']);
});

test('no subaccounts → empty', () => {
  const result = findSubaccountsWithNoRoot([], []);
  assertEqual(result, []);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
console.log(`[subaccountNoRoot] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
