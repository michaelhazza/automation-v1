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

  it('rejects extraWhere that does not match the allowlist shape', () => {
    expect(() =>
      definePruneJob({
        source: 'test-job',
        table: 'test_table',
        retentionDays: 1,
        cutoffColumn: 'created_at',
        extraWhere: "; DROP TABLE x;",
      }),
    ).toThrow('extraWhere must match allowlist');
  });

  it('rejects extraWhere with smuggled extra clauses (W5K-ADV-1)', () => {
    expect(() =>
      definePruneJob({
        source: 'test-job',
        table: 'test_table',
        retentionDays: 1,
        cutoffColumn: 'created_at',
        extraWhere: 'AND 1=1 OR is_active = false',
      }),
    ).toThrow('extraWhere must match allowlist');
  });

  it('accepts allowlisted extraWhere shapes (W5K-ADV-1)', () => {
    const acceptedShapes = [
      'AND pinned_at IS NULL',
      'AND pinned_at IS NOT NULL',
      'OR is_active = false',
      'AND status = true',
      'AND retry_count = 5',
      'AND retry_count != 0',
      'AND threshold <= 1.5',
      'AND score > -1',
      'AND score >= -2.5',
      'AND code <> 0',
      "AND status = 'admin'",
      "OR label = 'foo'",
    ];
    for (const extraWhere of acceptedShapes) {
      expect(() =>
        definePruneJob({
          source: 'test-job',
          table: 'test_table',
          retentionDays: 1,
          cutoffColumn: 'created_at',
          extraWhere,
        }),
      ).not.toThrow();
    }
  });

  it('rejects extraWhere with quote/semicolon/escape injection (W5K-ADV-1)', () => {
    const rejectedShapes = [
      "AND status = 'admin'; DROP TABLE x;--",
      "AND col = 'a' OR '1' = '1'",
      "AND col = 'has\\\\quote'",
      'AND col = "double_quoted"',
      'AND col = $1',
      'AND 1=1',
      'AND col IN (1,2)',
      'AND col LIKE \'%foo%\'',
      'AND col = (SELECT 1)',
      'OR col = `backtick`',
      // chatgpt-pr-review R1 F1: `col = null` and `col != null` are
      // semantically broken in SQL (NULL never equals anything, including
      // itself; only IS NULL / IS NOT NULL work). The allowlist forbids
      // them so a future caller cannot silently introduce a prune job that
      // matches zero rows.
      'AND deleted_at = null',
      'OR deleted_at != null',
      'AND deleted_at <> null',
    ];
    for (const extraWhere of rejectedShapes) {
      expect(() =>
        definePruneJob({
          source: 'test-job',
          table: 'test_table',
          retentionDays: 1,
          cutoffColumn: 'created_at',
          extraWhere,
        }),
      ).toThrow('extraWhere must match allowlist');
    }
  });
});
