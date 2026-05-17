import { describe, it, expect } from 'vitest';
import { computePruneStatus, definePruneJob } from '../definePruneJob.js';

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

describe('definePruneJob — retention input validation (Wave 5 F-3 factory extension)', () => {
  // The factory body validates inputs synchronously when called; the returned
  // function is never invoked here so no DB connection is touched.

  it('throws when neither retentionDays nor retentionMillis is provided', () => {
    expect(() =>
      definePruneJob({
        source: 'test-job',
        table: 'test_table',
        cutoffColumn: 'created_at',
      } as never),
    ).toThrow('exactly one of retentionDays or retentionMillis must be provided');
  });

  it('throws when BOTH retentionDays and retentionMillis are provided', () => {
    expect(() =>
      definePruneJob({
        source: 'test-job',
        table: 'test_table',
        retentionDays: 7,
        retentionMillis: 1000,
        cutoffColumn: 'created_at',
      }),
    ).toThrow('exactly one of retentionDays or retentionMillis must be provided');
  });

  it('accepts retentionDays alone', () => {
    expect(() =>
      definePruneJob({
        source: 'test-job',
        table: 'test_table',
        retentionDays: 90,
        cutoffColumn: 'created_at',
      }),
    ).not.toThrow();
  });

  it('accepts retentionMillis alone (sub-day window for webhook nonce dedup)', () => {
    expect(() =>
      definePruneJob({
        source: 'test-job',
        table: 'test_table',
        retentionMillis: 10 * 60 * 1000,
        cutoffColumn: 'seen_at',
      }),
    ).not.toThrow();
  });

  it('rejects unsafe table identifier (sql.raw injection guard)', () => {
    expect(() =>
      definePruneJob({
        source: 'test-job',
        table: 'bad table; DROP',
        retentionDays: 1,
        cutoffColumn: 'created_at',
      }),
    ).toThrow('table must be a simple SQL identifier');
  });

  it('rejects unsafe cutoffColumn identifier', () => {
    expect(() =>
      definePruneJob({
        source: 'test-job',
        table: 'test_table',
        retentionDays: 1,
        cutoffColumn: 'created_at; DROP',
      }),
    ).toThrow('cutoffColumn must be a simple SQL identifier');
  });

  it('rejects extraWhere that does not start with AND or OR', () => {
    expect(() =>
      definePruneJob({
        source: 'test-job',
        table: 'test_table',
        retentionDays: 1,
        cutoffColumn: 'created_at',
        extraWhere: "; DROP TABLE x;",
      }),
    ).toThrow('extraWhere must start with AND or OR');
  });
});
