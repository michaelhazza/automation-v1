import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatTime, formatConvDate } from '../format';

describe('formatTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns HH:MM for a date string that is today', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    const result = formatTime('2026-05-15T09:30:00.000Z');
    expect(result).toMatch(/^\d{1,2}:\d{2}/);
    expect(result).not.toContain('May');
  });

  it('includes month and day for a date string that is not today', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    const result = formatTime('2026-05-10T09:30:00.000Z');
    expect(result).toContain('May');
    expect(result).toContain('10');
  });
});

describe('formatConvDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns Today for a date string from today', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    const result = formatConvDate('2026-05-15T08:00:00.000Z');
    expect(result).toBe('Today');
  });

  it('returns Yesterday for a date string from 1 day ago', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    const result = formatConvDate('2026-05-14T08:00:00.000Z');
    expect(result).toBe('Yesterday');
  });

  it('returns Nd ago for a date 2-6 days ago', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    const result = formatConvDate('2026-05-12T12:00:00.000Z');
    expect(result).toBe('3d ago');
  });

  it('returns month and day for a date 7+ days ago', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    const result = formatConvDate('2026-05-01T12:00:00.000Z');
    expect(result).toContain('May');
    expect(result).toContain('1');
  });
});
