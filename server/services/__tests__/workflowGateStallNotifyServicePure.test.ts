import { describe, it, expect } from 'vitest';
import {
  buildStallJobName,
  isStallFireStale,
  CADENCE_SECONDS,
  STALL_CADENCES,
} from '../workflowGateStallNotifyServicePure.js';

describe('buildStallJobName', () => {
  it('returns correct pattern', () => {
    expect(buildStallJobName('abc', '72h')).toBe('stall-notify-abc-72h');
  });
});

describe('isStallFireStale', () => {
  const T0 = new Date('2024-01-01T00:00:00.000Z');
  const T1 = new Date('2024-01-02T00:00:00.000Z');

  it('returns false for open gate with matching createdAt', () => {
    expect(isStallFireStale(null, T0, T0.toISOString())).toBe(false);
  });

  it('returns true when gate is resolved', () => {
    expect(isStallFireStale(T1, T0, T0.toISOString())).toBe(true);
  });

  it('returns true when createdAt does not match expectedCreatedAt', () => {
    expect(isStallFireStale(null, T1, T0.toISOString())).toBe(true);
  });
});

describe('CADENCE_SECONDS', () => {
  it('has correct values', () => {
    expect(CADENCE_SECONDS['24h']).toBe(86400);
    expect(CADENCE_SECONDS['72h']).toBe(259200);
    expect(CADENCE_SECONDS['7d']).toBe(604800);
  });
  it('covers all cadences', () => {
    STALL_CADENCES.forEach(c => expect(CADENCE_SECONDS[c]).toBeGreaterThan(0));
  });
});
