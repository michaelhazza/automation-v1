import { describe, it, expect } from 'vitest';
import { computeDecayWeight } from '../decayPure.js';
import type { ConsolidationTier, MemoryConsolidationConfig } from '../../../../shared/types/memoryConsolidation.js';

function makeConfig(S: Record<ConsolidationTier, number>): MemoryConsolidationConfig['decayConfig'] {
  return { strengthByTier: S };
}

const defaultStrengths: Record<ConsolidationTier, number> = {
  working: 3,
  episodic: 14,
  semantic: 90,
  procedural: 999999,
};

describe('computeDecayWeight', () => {
  it('working tier at t=0 returns 1.0', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const result = computeDecayWeight('working', now, now, makeConfig(defaultStrengths));
    expect(result).toBe(1.0);
  });

  it('working tier at t=1 day with S=3 returns approximately exp(-1/3)', () => {
    const lastAccessedAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-01-02T00:00:00Z');
    const result = computeDecayWeight('working', lastAccessedAt, now, makeConfig({ ...defaultStrengths, working: 3 }));
    expect(result).toBeCloseTo(Math.exp(-1 / 3), 3);
  });

  it('episodic tier at t=30 days with S=14 returns approximately exp(-30/14)', () => {
    const lastAccessedAt = new Date('2025-12-01T00:00:00Z');
    const now = new Date('2025-12-31T00:00:00Z');
    const result = computeDecayWeight('episodic', lastAccessedAt, now, makeConfig({ ...defaultStrengths, episodic: 14 }));
    expect(result).toBeCloseTo(Math.exp(-30 / 14), 2);
  });

  it('semantic tier at t=30 days with S=90 returns approximately exp(-30/90) > 0.7', () => {
    const lastAccessedAt = new Date('2025-12-01T00:00:00Z');
    const now = new Date('2025-12-31T00:00:00Z');
    const result = computeDecayWeight('semantic', lastAccessedAt, now, makeConfig({ ...defaultStrengths, semantic: 90 }));
    expect(result).toBeGreaterThan(0.7);
  });

  it('procedural tier at t=365 days returns 1.0 exactly', () => {
    const lastAccessedAt = new Date('2025-01-01T00:00:00Z');
    const now = new Date('2026-01-01T00:00:00Z');
    const result = computeDecayWeight('procedural', lastAccessedAt, now, makeConfig(defaultStrengths));
    expect(result).toBe(1.0);
  });

  it('null lastAccessedAt returns 1.0 exactly', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const result = computeDecayWeight('working', null, now, makeConfig(defaultStrengths));
    expect(result).toBe(1.0);
  });

  it('negative t (future timestamp) returns 1.0 exactly', () => {
    const lastAccessedAt = new Date('2026-01-02T00:00:00Z');
    const now = new Date('2026-01-01T00:00:00Z');
    const result = computeDecayWeight('working', lastAccessedAt, now, makeConfig(defaultStrengths));
    expect(result).toBe(1.0);
  });
});
