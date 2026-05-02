/**
 * server/services/optimiser/__tests__/optimiserCronPure.test.ts
 *
 * Pure tests for computeOptimiserCron.
 * No DB imports, no I/O. Uses Vitest.
 */

import { describe, it, expect } from 'vitest';
import { computeOptimiserCron } from '../optimiserCronPure.js';
import { randomUUID } from 'crypto';

// ── Helper: parse the cron into { minute, hour } ─────────────────────────────

function parseCron(cron: string): { minute: number; hour: number } {
  const parts = cron.split(' ');
  return {
    minute: parseInt(parts[0], 10),
    hour: parseInt(parts[1], 10),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeOptimiserCron', () => {
  it('returns a 5-field cron string matching /^\\d{1,2} \\d{1,2} \\* \\* \\*$/', () => {
    const cron = computeOptimiserCron(randomUUID());
    expect(cron).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });

  it('minute is in [0, 59]', () => {
    for (let i = 0; i < 50; i++) {
      const { minute } = parseCron(computeOptimiserCron(randomUUID()));
      expect(minute).toBeGreaterThanOrEqual(0);
      expect(minute).toBeLessThanOrEqual(59);
    }
  });

  it('hour is in [6, 11]', () => {
    for (let i = 0; i < 50; i++) {
      const { hour } = parseCron(computeOptimiserCron(randomUUID()));
      expect(hour).toBeGreaterThanOrEqual(6);
      expect(hour).toBeLessThanOrEqual(11);
    }
  });

  it('is deterministic — same input always produces same output', () => {
    const id = randomUUID();
    const first = computeOptimiserCron(id);
    const second = computeOptimiserCron(id);
    const third = computeOptimiserCron(id);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('different UUIDs produce different crons (high probability)', () => {
    const ids = Array.from({ length: 100 }, () => randomUUID());
    const crons = new Set(ids.map(computeOptimiserCron));
    // 100 UUIDs across 360 distinct (min,hour) combos — should have many distinct crons
    expect(crons.size).toBeGreaterThan(50);
  });

  it('distribution check: minutes spread across 0-59 (1000 UUIDs, chi-squared)', () => {
    const SAMPLE = 1000;
    const BINS = 60;
    const minuteCounts = new Array<number>(BINS).fill(0);

    for (let i = 0; i < SAMPLE; i++) {
      const { minute } = parseCron(computeOptimiserCron(randomUUID()));
      minuteCounts[minute]++;
    }

    // Every bin should have at least 1 occurrence with 1000 samples
    // (probability of any single bin being empty is (59/60)^1000 ≈ 5.5e-8)
    for (const count of minuteCounts) {
      expect(count).toBeGreaterThan(0);
    }

    // Chi-squared: sum of (observed - expected)^2 / expected
    // Expected = 1000/60 ≈ 16.67; chi-squared critical value at p=0.001, df=59 is ~100
    const expected = SAMPLE / BINS;
    const chiSquared = minuteCounts.reduce((sum, count) => {
      return sum + Math.pow(count - expected, 2) / expected;
    }, 0);

    // A truly uniform distribution should produce chi-squared well below 100
    expect(chiSquared).toBeLessThan(100);
  });

  it('distribution check: hours spread across 6-11 (1000 UUIDs)', () => {
    const SAMPLE = 1000;
    const hourCounts = new Array<number>(6).fill(0); // hours 6-11

    for (let i = 0; i < SAMPLE; i++) {
      const { hour } = parseCron(computeOptimiserCron(randomUUID()));
      hourCounts[hour - 6]++;
    }

    // Every hour bucket should have some occurrences
    for (const count of hourCounts) {
      expect(count).toBeGreaterThan(0);
    }

    // Chi-squared for 6 buckets: critical value at p=0.001, df=5 is ~20
    const expected = SAMPLE / 6;
    const chiSquared = hourCounts.reduce((sum, count) => {
      return sum + Math.pow(count - expected, 2) / expected;
    }, 0);

    expect(chiSquared).toBeLessThan(20);
  });

  it('output format has exactly 5 fields separated by spaces', () => {
    const cron = computeOptimiserCron(randomUUID());
    const parts = cron.split(' ');
    expect(parts).toHaveLength(5);
    expect(parts[2]).toBe('*');
    expect(parts[3]).toBe('*');
    expect(parts[4]).toBe('*');
  });
});
