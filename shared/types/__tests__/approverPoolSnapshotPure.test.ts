import { describe, test, expect } from 'vitest';
import {
  normaliseApproverPoolSnapshot,
  poolFingerprint,
  userInPool,
  InvalidApproverPoolSnapshotError,
} from '../approverPoolSnapshot.js';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';
const UUID_C = '33333333-3333-3333-3333-333333333333';
const UUID_A_UPPER = '11111111-1111-1111-1111-111111111111'.toUpperCase();

describe('normaliseApproverPoolSnapshot', () => {
  test('valid UUIDs are accepted', () => {
    const result = normaliseApproverPoolSnapshot([UUID_A, UUID_B]);
    expect(result).toEqual([UUID_A, UUID_B]);
  });

  test('uppercase UUIDs are normalised to lowercase', () => {
    const result = normaliseApproverPoolSnapshot([UUID_A_UPPER]);
    expect(result[0]).toBe(UUID_A);
  });

  test('duplicates are removed (first occurrence kept)', () => {
    const result = normaliseApproverPoolSnapshot([UUID_A, UUID_B, UUID_A]);
    expect(result).toHaveLength(2);
    expect(result).toEqual([UUID_A, UUID_B]);
  });

  test('duplicate uppercase normalised to same UUID is deduped', () => {
    const result = normaliseApproverPoolSnapshot([UUID_A, UUID_A_UPPER]);
    expect(result).toHaveLength(1);
  });

  test('empty array is accepted', () => {
    const result = normaliseApproverPoolSnapshot([]);
    expect(result).toEqual([]);
  });

  test('non-array input throws InvalidApproverPoolSnapshotError', () => {
    expect(() => normaliseApproverPoolSnapshot('not-an-array')).toThrow(
      InvalidApproverPoolSnapshotError,
    );
  });

  test('non-string element throws InvalidApproverPoolSnapshotError', () => {
    expect(() => normaliseApproverPoolSnapshot([42])).toThrow(
      InvalidApproverPoolSnapshotError,
    );
  });

  test('invalid UUID format throws InvalidApproverPoolSnapshotError', () => {
    expect(() => normaliseApproverPoolSnapshot(['not-a-uuid'])).toThrow(
      InvalidApproverPoolSnapshotError,
    );
  });

  test('UUID with wrong segment lengths throws', () => {
    expect(() => normaliseApproverPoolSnapshot(['1111-2222-3333-4444-5555'])).toThrow(
      InvalidApproverPoolSnapshotError,
    );
  });
});

describe('poolFingerprint', () => {
  test('same pool yields the same fingerprint regardless of insertion order', () => {
    const snap1 = normaliseApproverPoolSnapshot([UUID_A, UUID_B, UUID_C]);
    const snap2 = normaliseApproverPoolSnapshot([UUID_C, UUID_A, UUID_B]);
    // Both snapshots have the same UUIDs; fingerprint sorts internally
    expect(poolFingerprint(snap1)).toBe(poolFingerprint(snap2));
  });

  test('different pools yield different fingerprints', () => {
    const snap1 = normaliseApproverPoolSnapshot([UUID_A]);
    const snap2 = normaliseApproverPoolSnapshot([UUID_B]);
    expect(poolFingerprint(snap1)).not.toBe(poolFingerprint(snap2));
  });

  test('fingerprint is 16 hex chars', () => {
    const snap = normaliseApproverPoolSnapshot([UUID_A]);
    expect(poolFingerprint(snap)).toMatch(/^[0-9a-f]{16}$/);
  });

  test('fingerprint is stable across multiple calls', () => {
    const snap = normaliseApproverPoolSnapshot([UUID_A, UUID_B]);
    expect(poolFingerprint(snap)).toBe(poolFingerprint(snap));
  });

  test('empty pool has a defined fingerprint', () => {
    const snap = normaliseApproverPoolSnapshot([]);
    expect(typeof poolFingerprint(snap)).toBe('string');
    expect(poolFingerprint(snap)).toHaveLength(16);
  });
});

describe('userInPool', () => {
  test('user in pool is found', () => {
    const snap = normaliseApproverPoolSnapshot([UUID_A, UUID_B]);
    expect(userInPool(snap, UUID_A)).toBe(true);
  });

  test('user not in pool returns false', () => {
    const snap = normaliseApproverPoolSnapshot([UUID_A]);
    expect(userInPool(snap, UUID_B)).toBe(false);
  });

  test('lookup is case-insensitive (normalised userId)', () => {
    const snap = normaliseApproverPoolSnapshot([UUID_A]);
    expect(userInPool(snap, UUID_A.toUpperCase())).toBe(true);
  });

  test('empty pool always returns false', () => {
    const snap = normaliseApproverPoolSnapshot([]);
    expect(userInPool(snap, UUID_A)).toBe(false);
  });
});
