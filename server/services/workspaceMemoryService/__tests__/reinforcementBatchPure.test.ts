import { describe, it, expect } from 'vitest';
import {
  shouldFlushByTime,
  shouldFlushByCount,
  pruneOldestHalf,
} from '../reinforcementBatch.js';

describe('shouldFlushByTime', () => {
  it('returns true when elapsed equals the interval', () => {
    expect(shouldFlushByTime(0, 60_000, 60_000)).toBe(true);
  });

  it('returns false when elapsed is below the interval', () => {
    expect(shouldFlushByTime(0, 59_999, 60_000)).toBe(false);
  });

  it('returns true when elapsed exceeds the interval', () => {
    expect(shouldFlushByTime(0, 120_000, 60_000)).toBe(true);
  });
});

describe('shouldFlushByCount', () => {
  it('returns true when buffer size equals the threshold', () => {
    expect(shouldFlushByCount(500, 500)).toBe(true);
  });

  it('returns false when buffer size is below the threshold', () => {
    expect(shouldFlushByCount(499, 500)).toBe(false);
  });
});

describe('pruneOldestHalf', () => {
  it('4-entry map: returns last 2 entries', () => {
    const m = new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4]]);
    const result = pruneOldestHalf(m);
    expect(result.size).toBe(2);
    expect(result.has('c')).toBe(true);
    expect(result.has('d')).toBe(true);
    expect(result.has('a')).toBe(false);
    expect(result.has('b')).toBe(false);
  });

  it('1-entry map: returns empty map', () => {
    const m = new Map([['a', 1]]);
    const result = pruneOldestHalf(m);
    expect(result.size).toBe(0);
  });

  it('empty map: returns empty map', () => {
    const m = new Map<string, number>();
    const result = pruneOldestHalf(m);
    expect(result.size).toBe(0);
  });
});
