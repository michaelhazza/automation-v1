import { expect, test } from 'vitest';
import {
  userInPool,
} from '../workflowApproverPoolServicePure.js';

// ─── userInPool ───────────────────────────────────────────────────────────────

test('userInPool: returns true when userId is in snapshot', () => {
  const snapshot = ['user-1', 'user-2', 'user-3'];
  expect(userInPool(snapshot, 'user-2')).toBe(true);
});

test('userInPool: returns false when userId is not in snapshot', () => {
  const snapshot = ['user-1', 'user-2'];
  expect(userInPool(snapshot, 'user-99')).toBe(false);
});

test('userInPool: returns false when snapshot is null', () => {
  expect(userInPool(null, 'user-1')).toBe(false);
});

test('userInPool: returns false when snapshot is empty array', () => {
  expect(userInPool([], 'user-1')).toBe(false);
});

test('userInPool: returns false when userId is empty string and not in snapshot', () => {
  const snapshot = ['user-1', 'user-2'];
  expect(userInPool(snapshot, '')).toBe(false);
});

test('userInPool: returns false when userId is empty string and snapshot is empty', () => {
  expect(userInPool([], '')).toBe(false);
});

