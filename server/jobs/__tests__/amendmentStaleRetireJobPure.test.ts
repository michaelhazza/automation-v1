import { describe, it, expect } from 'vitest';
import { isStale } from '../amendmentStaleRetireJobPure.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_THRESHOLD_MS = 14 * DAY_MS;

describe('isStale', () => {
  const now = new Date('2026-01-15T12:00:00.000Z');

  it('returns false for a record created exactly 14 days ago to the millisecond', () => {
    const createdAt = new Date(now.getTime() - STALE_THRESHOLD_MS);
    expect(isStale(createdAt, now)).toBe(false);
  });

  it('returns true for a record created 1ms past the 14-day threshold', () => {
    const createdAt = new Date(now.getTime() - STALE_THRESHOLD_MS - 1);
    expect(isStale(createdAt, now)).toBe(true);
  });

  it('returns false for a record created 1ms before the 14-day threshold', () => {
    const createdAt = new Date(now.getTime() - STALE_THRESHOLD_MS + 1);
    expect(isStale(createdAt, now)).toBe(false);
  });

  it('returns false for a record created today', () => {
    expect(isStale(now, now)).toBe(false);
  });

  it('returns true for a record created 30 days ago', () => {
    const createdAt = new Date(now.getTime() - 30 * DAY_MS);
    expect(isStale(createdAt, now)).toBe(true);
  });
});
