import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatCents, formatTokens, monthLabel, prevMonth, nextMonth, parseFallbackChain, anomalyColor } from '../format.js';
import { ANOMALY_THRESHOLDS } from '../constants.js';

describe('formatCents', () => {
  it('returns — for null', () => {
    expect(formatCents(null)).toBe('—');
  });

  it('returns — for undefined', () => {
    expect(formatCents(undefined)).toBe('—');
  });

  it('returns $0.00 for 0', () => {
    expect(formatCents(0)).toBe('$0.00');
  });

  it('pads cents below 100 correctly (5 -> $0.05)', () => {
    expect(formatCents(5)).toBe('$0.05');
  });

  it('pads cents below 100 correctly (99 -> $0.99)', () => {
    expect(formatCents(99)).toBe('$0.99');
  });

  it('formats 100 cents as $1.00', () => {
    expect(formatCents(100)).toBe('$1.00');
  });

  it('formats 12345 cents as $123.45', () => {
    expect(formatCents(12345)).toBe('$123.45');
  });
});

describe('formatTokens', () => {
  it('returns — for null', () => {
    expect(formatTokens(null)).toBe('—');
  });

  it('returns — for undefined', () => {
    expect(formatTokens(undefined)).toBe('—');
  });

  it('returns string representation for sub-1k', () => {
    expect(formatTokens(500)).toBe('500');
  });

  it('returns NK format for >= 1000 (1000 -> 1K)', () => {
    expect(formatTokens(1000)).toBe('1K');
  });

  it('rounds to nearest K (1500 -> 2K)', () => {
    expect(formatTokens(1500)).toBe('2K');
  });

  it('returns NM format for >= 1_000_000 (1_500_000 -> 1.5M)', () => {
    expect(formatTokens(1_500_000)).toBe('1.5M');
  });
});

describe('monthLabel', () => {
  it('returns January 2026 for 2026-01', () => {
    const result = monthLabel('2026-01');
    expect(result).toContain('January');
    expect(result).toContain('2026');
  });

  it('returns December 2026 for 2026-12', () => {
    const result = monthLabel('2026-12');
    expect(result).toContain('December');
    expect(result).toContain('2026');
  });
});

describe('prevMonth', () => {
  it('returns 2026-04 for 2026-05', () => {
    expect(prevMonth('2026-05')).toBe('2026-04');
  });

  it('rolls back year correctly (2026-01 -> 2025-12)', () => {
    expect(prevMonth('2026-01')).toBe('2025-12');
  });
});

describe('nextMonth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances one month when not at current month (2026-04 -> 2026-05)', () => {
    expect(nextMonth('2026-04')).toBe('2026-05');
  });

  it('clamps at current month (2026-05 stays 2026-05)', () => {
    expect(nextMonth('2026-05')).toBe('2026-05');
  });
});

describe('parseFallbackChain', () => {
  it('returns null for null input', () => {
    expect(parseFallbackChain(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseFallbackChain('')).toBeNull();
  });

  it('parses a valid JSON array', () => {
    const raw = JSON.stringify([{ provider: 'anthropic', model: 'claude-3', success: true }]);
    const result = parseFallbackChain(raw);
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result![0].provider).toBe('anthropic');
  });

  it('returns null for malformed JSON (no throw)', () => {
    expect(parseFallbackChain('{not valid')).toBeNull();
  });

  it('returns null for non-array JSON (e.g. object)', () => {
    expect(parseFallbackChain('{"key":"value"}')).toBeNull();
  });

  it('returns null for non-array JSON (e.g. string)', () => {
    expect(parseFallbackChain('"just a string"')).toBeNull();
  });
});

describe('anomalyColor', () => {
  const thresholds = ANOMALY_THRESHOLDS.fallback; // { warn: 0.05, danger: 0.15 }

  it('returns emerald (slate band) for value below warn threshold', () => {
    const result = anomalyColor(0.01, thresholds);
    expect(result).toContain('text-emerald-600');
  });

  it('returns amber band for value >= warn and < danger', () => {
    const result = anomalyColor(0.08, thresholds);
    expect(result).toContain('text-amber-600');
  });

  it('returns red band for value >= danger', () => {
    const result = anomalyColor(0.20, thresholds);
    expect(result).toContain('text-red-600');
  });

  it('treats exact warn boundary as amber', () => {
    const result = anomalyColor(0.05, thresholds);
    expect(result).toContain('text-amber-600');
  });

  it('treats exact danger boundary as red', () => {
    const result = anomalyColor(0.15, thresholds);
    expect(result).toContain('text-red-600');
  });
});
