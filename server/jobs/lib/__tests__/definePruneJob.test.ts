import { describe, it, expect } from 'vitest';
import { computePruneStatus } from '../definePruneJob.js';

describe('computePruneStatus', () => {
  it('returns success when no orgs failed', () => {
    expect(computePruneStatus(5, 0)).toBe('success');
  });

  it('returns failed when no orgs succeeded', () => {
    expect(computePruneStatus(0, 3)).toBe('failed');
  });

  it('returns partial when some orgs succeeded and some failed', () => {
    expect(computePruneStatus(3, 2)).toBe('partial');
  });

  it('returns success when both counts are zero (vacuous case)', () => {
    expect(computePruneStatus(0, 0)).toBe('success');
  });
});
