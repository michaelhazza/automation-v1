/**
 * gate-baseline-helpers.test.ts
 *
 * Vitest unit tests for the pure helper functions in
 * scripts/lib/gate-baseline-helpers.mjs:
 *   - parseBaselineFile
 *   - isExpired
 *   - isPastGracePeriod
 *
 * Run via: npx vitest run scripts/__tests__/gate-baseline-helpers.test.ts
 */

import { describe, expect, test } from 'vitest';
import { isExpired, isPastGracePeriod, parseBaselineFile } from '../lib/gate-baseline-helpers.mjs';

// ── parseBaselineFile ─────────────────────────────────────────────────────────

describe('parseBaselineFile — no expiry directive', () => {
  test('(a) entry with no preceding expires comment → parsed as never-expiring (expires: null)', () => {
    const text = [
      '# general comment',
      'server/routes/foo.ts:42:direct db import',
    ].join('\n');

    const results = parseBaselineFile(text);
    expect(results).toHaveLength(1);
    const entry = results[0];
    expect('error' in entry).toBe(false);
    if (!('error' in entry)) {
      expect(entry.key).toBe('server/routes/foo.ts:42:direct db import');
      expect(entry.expires).toBeNull();
    }
  });

  test('blank file → empty results', () => {
    expect(parseBaselineFile('')).toHaveLength(0);
    expect(parseBaselineFile('\n\n\n')).toHaveLength(0);
  });

  test('comment-only file → empty results', () => {
    const text = '# this is just a comment\n# another comment\n';
    expect(parseBaselineFile(text)).toHaveLength(0);
  });
});

describe('parseBaselineFile — entry with expiry', () => {
  test('entry preceded by # expires: line → parsed with correct date', () => {
    const text = [
      '# expires: 2026-08-14',
      'server/routes/supportAgentRoutes.ts:87:direct db import',
    ].join('\n');

    const results = parseBaselineFile(text);
    expect(results).toHaveLength(1);
    const entry = results[0];
    expect('error' in entry).toBe(false);
    if (!('error' in entry)) {
      expect(entry.expires).toBe('2026-08-14');
      expect(entry.key).toBe('server/routes/supportAgentRoutes.ts:87:direct db import');
    }
  });

  test('expires directive followed by blank line does NOT carry over to the next entry', () => {
    const text = [
      '# expires: 2026-08-14',
      '',
      'server/routes/foo.ts:10:some violation',
    ].join('\n');

    const results = parseBaselineFile(text);
    expect(results).toHaveLength(1);
    const entry = results[0];
    if (!('error' in entry)) {
      expect(entry.expires).toBeNull();
    }
  });

  test('multiple entries each with their own expiry', () => {
    const text = [
      '# expires: 2026-06-01',
      'server/routes/a.ts:1:violation a',
      '# expires: 2026-09-30',
      'server/routes/b.ts:2:violation b',
    ].join('\n');

    const results = parseBaselineFile(text);
    expect(results).toHaveLength(2);
    if (!('error' in results[0])) {
      expect(results[0].expires).toBe('2026-06-01');
    }
    if (!('error' in results[1])) {
      expect(results[1].expires).toBe('2026-09-30');
    }
  });
});

describe('parseBaselineFile — (d) malformed entry returns explicit error, not silent skip', () => {
  test('line missing line-number segment → error result', () => {
    const text = 'server/routes/foo.ts:missing-lineno';
    const results = parseBaselineFile(text);
    expect(results).toHaveLength(1);
    expect('error' in results[0]).toBe(true);
  });

  test('line with no colons → error result', () => {
    const text = 'justaplainstring';
    const results = parseBaselineFile(text);
    expect(results).toHaveLength(1);
    expect('error' in results[0]).toBe(true);
  });

  test('malformed line carries error message describing the problem', () => {
    const text = 'not:valid';
    const results = parseBaselineFile(text);
    expect(results).toHaveLength(1);
    if ('error' in results[0]) {
      expect(typeof results[0].error).toBe('string');
      expect(results[0].error.length).toBeGreaterThan(0);
    }
  });

  test('malformed line mixed with valid entry — valid entry is still returned', () => {
    const text = [
      'badentry',
      '# expires: 2026-08-14',
      'server/routes/good.ts:5:real violation',
    ].join('\n');
    const results = parseBaselineFile(text);
    expect(results).toHaveLength(2);
    expect('error' in results[0]).toBe(true);
    expect('error' in results[1]).toBe(false);
  });
});

// ── isExpired ─────────────────────────────────────────────────────────────────

describe('isExpired', () => {
  test('(b) expiry date equals today → expired (warning)', () => {
    const today = '2026-05-14';
    expect(isExpired('2026-05-14', today)).toBe(true);
  });

  test('expiry date in the past → expired', () => {
    expect(isExpired('2026-01-01', '2026-05-14')).toBe(true);
  });

  test('expiry date in the future → not expired', () => {
    expect(isExpired('2027-01-01', '2026-05-14')).toBe(false);
  });

  test('expiry date one day before today → expired', () => {
    expect(isExpired('2026-05-13', '2026-05-14')).toBe(true);
  });

  test('expiry date one day after today → not expired', () => {
    expect(isExpired('2026-05-15', '2026-05-14')).toBe(false);
  });
});

// ── isPastGracePeriod ─────────────────────────────────────────────────────────

describe('isPastGracePeriod', () => {
  test('(c) expired 31 days ago with GATE_GRACE_DAYS=30 → past grace period (error)', () => {
    // expiry: 2026-04-13, today: 2026-05-14 — that is 31 days after expiry
    const expiryDate = '2026-04-13';
    const today = '2026-05-14';
    expect(isPastGracePeriod(expiryDate, today, 30)).toBe(true);
  });

  test('expired exactly 30 days ago → NOT past grace period (grace period ends after 30 days)', () => {
    // expiryDate + 30 days = today exactly → todayDate is NOT > graceEnd
    const expiryDate = '2026-04-14';
    const today = '2026-05-14';
    expect(isPastGracePeriod(expiryDate, today, 30)).toBe(false);
  });

  test('expired 29 days ago → not past grace period', () => {
    const expiryDate = '2026-04-15';
    const today = '2026-05-14';
    expect(isPastGracePeriod(expiryDate, today, 30)).toBe(false);
  });

  test('not yet expired → not past grace period', () => {
    expect(isPastGracePeriod('2027-01-01', '2026-05-14', 30)).toBe(false);
  });

  test('default graceDays=30 is used when not provided', () => {
    // expired 31 days ago
    expect(isPastGracePeriod('2026-04-13', '2026-05-14')).toBe(true);
    // expired 30 days ago (exactly at grace boundary, not past)
    expect(isPastGracePeriod('2026-04-14', '2026-05-14')).toBe(false);
  });

  test('custom grace days — expired 8 days ago with grace=7 → past grace', () => {
    // expiry: 2026-05-06, today: 2026-05-14 → 8 days after expiry > 7 grace days
    expect(isPastGracePeriod('2026-05-06', '2026-05-14', 7)).toBe(true);
  });

  test('custom grace days — expired 7 days ago with grace=7 → NOT past grace', () => {
    // expiry: 2026-05-07, today: 2026-05-14 → exactly 7 days = grace end, not past
    expect(isPastGracePeriod('2026-05-07', '2026-05-14', 7)).toBe(false);
  });
});
