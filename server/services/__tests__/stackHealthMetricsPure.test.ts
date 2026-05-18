import { describe, it, expect } from 'vitest';
import {
  computeAmendmentDensity,
  computeRollbackRate,
  computeStaleRatio,
} from '../stackHealthMetricsService.js';

describe('computeAmendmentDensity', () => {
  it('returns 0 when there are no accepted amendments', () => {
    expect(computeAmendmentDensity(0)).toBe(0);
  });

  it('returns 0.5 for 10 accepted amendments', () => {
    expect(computeAmendmentDensity(10)).toBe(0.5);
  });

  it('returns 1.0 for 20 accepted amendments', () => {
    expect(computeAmendmentDensity(20)).toBe(1.0);
  });

  it('returns >1 for more than 20 amendments (no cap at Phase 1)', () => {
    expect(computeAmendmentDensity(40)).toBe(2.0);
  });
});

describe('computeRollbackRate', () => {
  it('returns 0 when accepts_30d is 0 (no division by zero)', () => {
    expect(computeRollbackRate(3, 0)).toBe(0);
  });

  it('returns 0 when there are no rollbacks', () => {
    expect(computeRollbackRate(0, 10)).toBe(0);
  });

  it('returns 0.5 for 5 rollbacks out of 10 accepts', () => {
    expect(computeRollbackRate(5, 10)).toBe(0.5);
  });

  it('returns 1.0 when all accepts were rolled back', () => {
    expect(computeRollbackRate(4, 4)).toBe(1.0);
  });
});

describe('computeStaleRatio', () => {
  it('returns 0 when total proposals is 0 (no division by zero)', () => {
    expect(computeStaleRatio(5, 0)).toBe(0);
  });

  it('returns 0 when there are no stale retirements', () => {
    expect(computeStaleRatio(0, 20)).toBe(0);
  });

  it('returns 0.25 for 5 stale out of 20 proposals', () => {
    expect(computeStaleRatio(5, 20)).toBe(0.25);
  });

  it('returns 1.0 when all proposals were retired as stale', () => {
    expect(computeStaleRatio(10, 10)).toBe(1.0);
  });
});
