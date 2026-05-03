/**
 * workflowApprovalPoolMembershipPure.test.ts — Pure function tests for the
 * approval-pool membership check.
 *
 * Covers: in pool, not in pool, null/empty snapshot, resolveSpecificUsersPool.
 *
 * V1 behaviour: org-admin status does NOT auto-bypass the pool.
 * Pool check is strict — only explicit membership grants access.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/workflowApprovalPoolMembershipPure.test.ts
 */

import { expect, test } from 'vitest';
import { userInPool, resolveSpecificUsersPool } from '../workflowApprovalPoolPure.js';

// ---------------------------------------------------------------------------
// userInPool
// ---------------------------------------------------------------------------

test('userInPool: user present in pool returns true', () => {
  const snapshot = ['user-1', 'user-2', 'user-3'];
  expect(userInPool(snapshot, 'user-2')).toBe(true);
});

test('userInPool: user absent from pool returns false', () => {
  const snapshot = ['user-1', 'user-2'];
  expect(userInPool(snapshot, 'user-99')).toBe(false);
});

test('userInPool: null snapshot allows all users (no pool configured)', () => {
  expect(userInPool(null, 'user-1')).toBe(true);
});

test('userInPool: undefined snapshot allows all users (no pool configured)', () => {
  expect(userInPool(undefined, 'user-1')).toBe(true);
});

test('userInPool: empty snapshot allows all users (no pool configured)', () => {
  expect(userInPool([], 'user-1')).toBe(true);
});

test('userInPool: org-admin is NOT an auto-bypass — must be in pool explicitly (V1 strict)', () => {
  // This test documents that V1 pool check is strict: admin user not in pool is rejected.
  const snapshot = ['user-1', 'user-2'];
  const adminUserId = 'admin-user-not-in-pool';
  // admin is NOT in pool => must return false (strict check, no admin override in V1)
  expect(userInPool(snapshot, adminUserId)).toBe(false);
});

test('userInPool: single-element pool — matching user returns true', () => {
  expect(userInPool(['only-user'], 'only-user')).toBe(true);
});

test('userInPool: single-element pool — non-matching user returns false', () => {
  expect(userInPool(['only-user'], 'other-user')).toBe(false);
});

// ---------------------------------------------------------------------------
// resolveSpecificUsersPool
// ---------------------------------------------------------------------------

test('resolveSpecificUsersPool: returns the input array unchanged', () => {
  const ids = ['user-a', 'user-b', 'user-c'];
  expect(resolveSpecificUsersPool(ids)).toEqual(ids);
});

test('resolveSpecificUsersPool: returns empty array for empty input', () => {
  expect(resolveSpecificUsersPool([])).toEqual([]);
});
