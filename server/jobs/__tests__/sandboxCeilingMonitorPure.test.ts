import { describe, it, expect } from 'vitest';
import {
  estimateSandboxCostCents,
  isWallClockCeilingTripped,
  isCostCeilingTripped,
} from '../sandboxCeilingMonitorPure.js';

describe('estimateSandboxCostCents', () => {
  it('returns 0 for 0 elapsed ms', () => {
    expect(estimateSandboxCostCents(0, 0.01)).toBe(0);
  });

  it('computes correct estimate for 1 second at 0.01 cents/s', () => {
    // 1000ms / 1000 * 0.01 = 0.01
    expect(estimateSandboxCostCents(1_000, 0.01)).toBeCloseTo(0.01);
  });

  it('computes correct estimate for 60 seconds at 0.00042 cents/s', () => {
    // 60000ms / 1000 * 0.00042 = 0.0252
    expect(estimateSandboxCostCents(60_000, 0.00042)).toBeCloseTo(0.0252);
  });

  it('scales linearly with elapsed time', () => {
    const rate = 0.5;
    const t1 = estimateSandboxCostCents(1_000, rate);
    const t2 = estimateSandboxCostCents(2_000, rate);
    expect(t2).toBeCloseTo(t1 * 2);
  });

  it('returns 0 for negative elapsedMs', () => {
    expect(estimateSandboxCostCents(-100, 0.01)).toBe(0);
  });

  it('returns 0 for negative maxCostCentsPerSecond', () => {
    expect(estimateSandboxCostCents(1_000, -0.01)).toBe(0);
  });

  it('returns 0 for both zero', () => {
    expect(estimateSandboxCostCents(0, 0)).toBe(0);
  });

  it('handles very small rates (e2b cpu-small class)', () => {
    // 30 minutes at cpu-small worst-case
    const thirtyMinMs = 30 * 60 * 1000;
    const rate = 0.00042;
    const result = estimateSandboxCostCents(thirtyMinMs, rate);
    // 1800 * 0.00042 = 0.756
    expect(result).toBeCloseTo(0.756, 3);
  });

  it('handles large elapsed time (120 minutes)', () => {
    const twoHoursMs = 120 * 60 * 1000;
    const result = estimateSandboxCostCents(twoHoursMs, 0.01);
    // 7200 * 0.01 = 72
    expect(result).toBeCloseTo(72);
  });
});

describe('isWallClockCeilingTripped', () => {
  it('returns false when elapsed is below ceiling', () => {
    expect(isWallClockCeilingTripped(59_000, 60_000)).toBe(false);
  });

  it('returns true when elapsed equals ceiling', () => {
    expect(isWallClockCeilingTripped(60_000, 60_000)).toBe(true);
  });

  it('returns true when elapsed exceeds ceiling', () => {
    expect(isWallClockCeilingTripped(61_000, 60_000)).toBe(true);
  });

  it('returns false for zero elapsed with non-zero ceiling', () => {
    expect(isWallClockCeilingTripped(0, 5_000)).toBe(false);
  });

  it('returns true for any elapsed when ceiling is 0', () => {
    expect(isWallClockCeilingTripped(1, 0)).toBe(true);
  });
});

describe('isCostCeilingTripped', () => {
  it('returns false when estimated cost is below ceiling', () => {
    expect(isCostCeilingTripped(0.009, 0.01)).toBe(false);
  });

  it('returns true when estimated cost equals ceiling', () => {
    expect(isCostCeilingTripped(0.01, 0.01)).toBe(true);
  });

  it('returns true when estimated cost exceeds ceiling', () => {
    expect(isCostCeilingTripped(0.015, 0.01)).toBe(true);
  });

  it('returns false for zero cost with positive ceiling', () => {
    expect(isCostCeilingTripped(0, 100)).toBe(false);
  });

  it('returns true for any positive cost when ceiling is 0', () => {
    expect(isCostCeilingTripped(0.001, 0)).toBe(true);
  });
});
