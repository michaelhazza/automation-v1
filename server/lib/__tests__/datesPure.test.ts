import { describe, it, expect } from 'vitest';
import { parseDueDate, DueDateParseError } from '../dates.js';

describe('parseDueDate', () => {
  it('converts 2026-05-20 + America/New_York to UTC 2026-05-20T04:00:00.000Z', () => {
    const result = parseDueDate('2026-05-20', 'America/New_York');
    expect(result.toISOString()).toBe('2026-05-20T04:00:00.000Z');
  });

  it('converts 2026-05-20 + UTC to 2026-05-20T00:00:00.000Z', () => {
    const result = parseDueDate('2026-05-20', 'UTC');
    expect(result.toISOString()).toBe('2026-05-20T00:00:00.000Z');
  });

  it('converts 2026-05-20 + null to 2026-05-20T00:00:00.000Z', () => {
    const result = parseDueDate('2026-05-20', null);
    expect(result.toISOString()).toBe('2026-05-20T00:00:00.000Z');
  });

  it('throws DueDateParseError with code invalid_format for 2026-13-45', () => {
    expect(() => parseDueDate('2026-13-45', 'UTC')).toThrow(DueDateParseError);
    try {
      parseDueDate('2026-13-45', 'UTC');
    } catch (err) {
      expect(err).toBeInstanceOf(DueDateParseError);
      expect((err as DueDateParseError).code).toBe('invalid_format');
    }
  });

  it('throws DueDateParseError with code invalid_format for empty string', () => {
    expect(() => parseDueDate('', 'UTC')).toThrow(DueDateParseError);
    try {
      parseDueDate('', 'UTC');
    } catch (err) {
      expect(err).toBeInstanceOf(DueDateParseError);
      expect((err as DueDateParseError).code).toBe('invalid_format');
    }
  });

  it('throws DueDateParseError with code invalid_timezone for Not/A_Zone', () => {
    expect(() => parseDueDate('2026-05-20', 'Not/A_Zone')).toThrow(DueDateParseError);
    try {
      parseDueDate('2026-05-20', 'Not/A_Zone');
    } catch (err) {
      expect(err).toBeInstanceOf(DueDateParseError);
      expect((err as DueDateParseError).code).toBe('invalid_timezone');
    }
  });

  it('throws DueDateParseError with code invalid_date for 2026-02-30', () => {
    expect(() => parseDueDate('2026-02-30', 'UTC')).toThrow(DueDateParseError);
    try {
      parseDueDate('2026-02-30', 'UTC');
    } catch (err) {
      expect(err).toBeInstanceOf(DueDateParseError);
      expect((err as DueDateParseError).code).toBe('invalid_date');
    }
  });

  it('handles DST spring-forward: 2026-03-08 + America/New_York returns a valid UTC instant for local day start', () => {
    // 2026-03-08 is when US clocks spring forward (02:00 -> 03:00).
    // EDT is UTC-4, so midnight (which exists as the clock hasn't jumped yet) = UTC 05:00.
    const result = parseDueDate('2026-03-08', 'America/New_York');
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).not.toBeNaN();
    // The local day 2026-03-08 starts at UTC 05:00:00 (EST = UTC-5)
    expect(result.toISOString()).toBe('2026-03-08T05:00:00.000Z');
  });

  it('is deterministic: same input triple returns same getTime() on three calls', () => {
    const t1 = parseDueDate('2026-05-20', 'America/New_York').getTime();
    const t2 = parseDueDate('2026-05-20', 'America/New_York').getTime();
    const t3 = parseDueDate('2026-05-20', 'America/New_York').getTime();
    expect(t1).toBe(t2);
    expect(t2).toBe(t3);
  });
});
