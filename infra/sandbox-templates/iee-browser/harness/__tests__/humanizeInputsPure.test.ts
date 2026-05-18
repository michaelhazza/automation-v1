import { describe, it, expect } from 'vitest';
import {
  generateMouseCurve,
  generateTypingIntervals,
  generateScrollMomentum,
  validateOptions,
  PROFILE_PARAMS,
} from '../humanizeInputsPure.js';

// Helper: compute p99 of an array of numbers
function p99(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.99) - 1;
  return sorted[Math.max(0, idx)];
}

describe('generateMouseCurve', () => {
  it('returns a single-point path when from === to', () => {
    const pt = { x: 100, y: 200 };
    const result = generateMouseCurve(pt, pt, 'balanced', 42);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(pt);
  });

  it('seed-replay determinism: same inputs produce identical output', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 500, y: 300 };
    const run1 = generateMouseCurve(from, to, 'light', 99999);
    const run2 = generateMouseCurve(from, to, 'light', 99999);
    expect(run1).toEqual(run2);
  });

  it('different seeds produce different outputs', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 500, y: 300 };
    const run1 = generateMouseCurve(from, to, 'balanced', 1);
    const run2 = generateMouseCurve(from, to, 'balanced', 2);
    expect(run1).not.toEqual(run2);
  });

  it('all three profiles produce different outputs for the same seed', () => {
    const from = { x: 10, y: 10 };
    const to = { x: 200, y: 150 };
    const light = generateMouseCurve(from, to, 'light', 12345);
    const balanced = generateMouseCurve(from, to, 'balanced', 12345);
    const heavy = generateMouseCurve(from, to, 'heavy', 12345);
    // At minimum, step counts differ (steps = max(3, round(median/10)))
    // light: max(3, 5)=5, balanced: max(3, 15)=15, heavy: max(3, 38)=38
    expect(light.length).not.toEqual(balanced.length);
    expect(balanced.length).not.toEqual(heavy.length);
  });
});

describe('generateTypingIntervals', () => {
  it('returns empty array for empty text', () => {
    expect(generateTypingIntervals('', 'light', 0)).toEqual([]);
    expect(generateTypingIntervals('', 'balanced', 0)).toEqual([]);
    expect(generateTypingIntervals('', 'heavy', 0)).toEqual([]);
  });

  it('seed-replay determinism: same inputs produce identical output', () => {
    const text = 'hello world';
    const run1 = generateTypingIntervals(text, 'balanced', 42);
    const run2 = generateTypingIntervals(text, 'balanced', 42);
    expect(run1).toEqual(run2);
  });

  it('returns one interval per character', () => {
    const text = 'abc';
    const result = generateTypingIntervals(text, 'light', 1);
    expect(result).toHaveLength(3);
  });

  it('all three profiles produce different outputs for the same seed', () => {
    const text = 'test';
    const light = generateTypingIntervals(text, 'light', 12345);
    const balanced = generateTypingIntervals(text, 'balanced', 12345);
    const heavy = generateTypingIntervals(text, 'heavy', 12345);
    expect(light).not.toEqual(balanced);
    expect(balanced).not.toEqual(heavy);
  });

  it('light profile: p99 < 100ms over 1000 intervals', () => {
    const intervals = generateTypingIntervals('a'.repeat(1000), 'light', 12345);
    const result = p99(intervals);
    expect(result).toBeLessThan(100);
  });

  it('balanced profile: p99 < 300ms over 1000 intervals', () => {
    const intervals = generateTypingIntervals('a'.repeat(1000), 'balanced', 12345);
    const result = p99(intervals);
    expect(result).toBeLessThan(300);
  });

  it('heavy profile: p99 < 750ms over 1000 intervals', () => {
    const intervals = generateTypingIntervals('a'.repeat(1000), 'heavy', 12345);
    const result = p99(intervals);
    expect(result).toBeLessThan(750);
  });

  it('all intervals are positive integers >= 10ms', () => {
    const intervals = generateTypingIntervals('hello', 'light', 7);
    for (const v of intervals) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('generateScrollMomentum', () => {
  it('returns empty array for delta = 0', () => {
    expect(generateScrollMomentum(0, 'light', 0)).toEqual([]);
    expect(generateScrollMomentum(0, 'balanced', 0)).toEqual([]);
    expect(generateScrollMomentum(0, 'heavy', 0)).toEqual([]);
  });

  it('seed-replay determinism: same inputs produce identical output', () => {
    const run1 = generateScrollMomentum(500, 'heavy', 77);
    const run2 = generateScrollMomentum(500, 'heavy', 77);
    expect(run1).toEqual(run2);
  });

  it('all three profiles produce different outputs for the same seed', () => {
    const light = generateScrollMomentum(300, 'light', 12345);
    const balanced = generateScrollMomentum(300, 'balanced', 12345);
    const heavy = generateScrollMomentum(300, 'heavy', 12345);
    expect(light).not.toEqual(balanced);
    expect(balanced).not.toEqual(heavy);
  });

  it('all intervals are positive integers >= 10ms', () => {
    const intervals = generateScrollMomentum(200, 'balanced', 3);
    for (const v of intervals) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('validateOptions', () => {
  it('accepts valid options', () => {
    expect(() => validateOptions({ profile: 'light', seed: 0 })).not.toThrow();
    expect(() => validateOptions({ profile: 'balanced', seed: 42 })).not.toThrow();
    expect(() => validateOptions({ profile: 'heavy', seed: 999 })).not.toThrow();
  });

  it('throws for invalid profile', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      validateOptions({ profile: 'off' as any, seed: 1 })
    ).toThrow("humanizeInputsPure: invalid options: profile must be 'light'|'balanced'|'heavy'");
  });

  it('throws for negative seed', () => {
    expect(() => validateOptions({ profile: 'light', seed: -1 })).toThrow(
      'humanizeInputsPure: invalid options: seed must be a non-negative integer'
    );
  });

  it('throws for fractional seed', () => {
    expect(() => validateOptions({ profile: 'balanced', seed: 1.5 })).toThrow(
      'humanizeInputsPure: invalid options: seed must be a non-negative integer'
    );
  });
});

describe('PROFILE_PARAMS', () => {
  it('light profile has median 50 and p99 90', () => {
    expect(PROFILE_PARAMS.light.median).toBe(50);
    expect(PROFILE_PARAMS.light.p99).toBe(90);
  });

  it('balanced profile has median 150 and p99 280', () => {
    expect(PROFILE_PARAMS.balanced.median).toBe(150);
    expect(PROFILE_PARAMS.balanced.p99).toBe(280);
  });

  it('heavy profile has median 380 and p99 700', () => {
    expect(PROFILE_PARAMS.heavy.median).toBe(380);
    expect(PROFILE_PARAMS.heavy.p99).toBe(700);
  });
});
