import { expect, test } from 'vitest';
import { decideDedupe } from '../clientErrorsLruPure.js';

test('fresh entry (not in LRU) → fresh', () => {
  const lru = new Map<string, number>();
  expect(decideDedupe({ hash: 'abc', lru, now: 1000, windowMs: 60_000 })).toBe('fresh');
});

test('same hash within window → duplicate', () => {
  const lru = new Map<string, number>();
  const hash = 'abc';
  const now = 100_000;
  lru.set(hash, now - 1000);
  expect(decideDedupe({ hash, lru, now, windowMs: 60_000 })).toBe('duplicate');
});

test('same hash after window expires → fresh', () => {
  const lru = new Map<string, number>();
  const hash = 'abc';
  const now = 100_000;
  lru.set(hash, now - 61_000);
  expect(decideDedupe({ hash, lru, now, windowMs: 60_000 })).toBe('fresh');
});

test('empty LRU → fresh', () => {
  const lru = new Map<string, number>();
  expect(decideDedupe({ hash: 'xyz', lru, now: 9999, windowMs: 60_000 })).toBe('fresh');
});
