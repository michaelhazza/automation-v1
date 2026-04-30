/**
 * agentRunCleanupJobPure.test.ts — Sprint 3 P2.1 Sprint 3A
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/agentRunCleanupJobPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  resolveRetentionDays,
  computeCutoffDate,
} from '../../jobs/agentRunCleanupJobPure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

console.log('');
console.log('agentRunCleanupJobPure — Sprint 3 P2.1 Sprint 3A');
console.log('');

// ── resolveRetentionDays ───────────────────────────────────────────

test('null override falls back to default', () => {
  expect(resolveRetentionDays(null, 90), 'null → 90').toBe(90);
});

test('undefined override falls back to default', () => {
  expect(resolveRetentionDays(undefined, 90), 'undefined → 90').toBe(90);
});

test('positive override wins over default', () => {
  expect(resolveRetentionDays(30, 90), '30 → 30').toBe(30);
});

test('large positive override wins over default', () => {
  expect(resolveRetentionDays(365, 90), '365 → 365').toBe(365);
});

test('zero override falls back to default (not "keep nothing")', () => {
  expect(resolveRetentionDays(0, 90), '0 → 90 fallback').toBe(90);
});

test('negative override falls back to default', () => {
  expect(resolveRetentionDays(-5, 90), '-5 → 90 fallback').toBe(90);
});

test('NaN override falls back to default', () => {
  expect(resolveRetentionDays(Number.NaN, 90), 'NaN → 90').toBe(90);
});

test('Infinity override falls back to default', () => {
  expect(resolveRetentionDays(Number.POSITIVE_INFINITY, 90), 'Infinity → 90 fallback').toBe(90);
});

test('fractional override is floored', () => {
  expect(resolveRetentionDays(30.9, 90), '30.9 → 30').toBe(30);
});

// ── computeCutoffDate ──────────────────────────────────────────────

test('cutoff is retentionDays earlier than now', () => {
  const now = new Date('2026-01-31T12:00:00.000Z');
  const cutoff = computeCutoffDate(now, 30);
  expect(cutoff.toISOString(), '30 days back').toBe('2026-01-01T12:00:00.000Z');
});

test('90-day retention subtracts exactly 90 * 86400000 ms', () => {
  const now = new Date('2026-04-01T00:00:00.000Z');
  const cutoff = computeCutoffDate(now, 90);
  const diff = now.getTime() - cutoff.getTime();
  expect(diff, '90 day delta').toEqual(90 * 24 * 60 * 60 * 1000);
});

test('zero retention returns now (no rows eligible if created_at < cutoff)', () => {
  const now = new Date('2026-04-01T00:00:00.000Z');
  const cutoff = computeCutoffDate(now, 0);
  expect(cutoff.getTime(), 'zero window').toEqual(now.getTime());
});

test('DST does not shift the cutoff by an hour', () => {
  // Arbitrary spring-forward window; helper is UTC-based so nothing drifts.
  const now = new Date('2026-03-15T00:00:00.000Z');
  const cutoff = computeCutoffDate(now, 1);
  const diff = now.getTime() - cutoff.getTime();
  expect(diff, 'always 24h for 1 day').toEqual(24 * 60 * 60 * 1000);
});

test('integer day retention returns an exact ms-aligned cutoff', () => {
  const now = new Date('2026-05-20T03:14:15.678Z');
  const cutoff = computeCutoffDate(now, 7);
  // Same sub-second precision as `now` — we subtract ms, not days-as-dates.
  expect(cutoff.getUTCMilliseconds(), 'ms preserved').toBe(678);
});

console.log('');
console.log('');
