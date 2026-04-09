/**
 * agentRunCleanupJobPure.test.ts — Sprint 3 P2.1 Sprint 3A
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/agentRunCleanupJobPure.test.ts
 */

import {
  resolveRetentionDays,
  computeCutoffDate,
} from '../../jobs/agentRunCleanupJobPure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

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
  assertEqual(resolveRetentionDays(null, 90), 90, 'null → 90');
});

test('undefined override falls back to default', () => {
  assertEqual(resolveRetentionDays(undefined, 90), 90, 'undefined → 90');
});

test('positive override wins over default', () => {
  assertEqual(resolveRetentionDays(30, 90), 30, '30 → 30');
});

test('large positive override wins over default', () => {
  assertEqual(resolveRetentionDays(365, 90), 365, '365 → 365');
});

test('zero override falls back to default (not "keep nothing")', () => {
  assertEqual(resolveRetentionDays(0, 90), 90, '0 → 90 fallback');
});

test('negative override falls back to default', () => {
  assertEqual(resolveRetentionDays(-5, 90), 90, '-5 → 90 fallback');
});

test('NaN override falls back to default', () => {
  assertEqual(resolveRetentionDays(Number.NaN, 90), 90, 'NaN → 90');
});

test('Infinity override falls back to default', () => {
  assertEqual(
    resolveRetentionDays(Number.POSITIVE_INFINITY, 90),
    90,
    'Infinity → 90 fallback',
  );
});

test('fractional override is floored', () => {
  assertEqual(resolveRetentionDays(30.9, 90), 30, '30.9 → 30');
});

// ── computeCutoffDate ──────────────────────────────────────────────

test('cutoff is retentionDays earlier than now', () => {
  const now = new Date('2026-01-31T12:00:00.000Z');
  const cutoff = computeCutoffDate(now, 30);
  assertEqual(cutoff.toISOString(), '2026-01-01T12:00:00.000Z', '30 days back');
});

test('90-day retention subtracts exactly 90 * 86400000 ms', () => {
  const now = new Date('2026-04-01T00:00:00.000Z');
  const cutoff = computeCutoffDate(now, 90);
  const diff = now.getTime() - cutoff.getTime();
  assertEqual(diff, 90 * 24 * 60 * 60 * 1000, '90 day delta');
});

test('zero retention returns now (no rows eligible if created_at < cutoff)', () => {
  const now = new Date('2026-04-01T00:00:00.000Z');
  const cutoff = computeCutoffDate(now, 0);
  assertEqual(cutoff.getTime(), now.getTime(), 'zero window');
});

test('DST does not shift the cutoff by an hour', () => {
  // Arbitrary spring-forward window; helper is UTC-based so nothing drifts.
  const now = new Date('2026-03-15T00:00:00.000Z');
  const cutoff = computeCutoffDate(now, 1);
  const diff = now.getTime() - cutoff.getTime();
  assertEqual(diff, 24 * 60 * 60 * 1000, 'always 24h for 1 day');
});

test('integer day retention returns an exact ms-aligned cutoff', () => {
  const now = new Date('2026-05-20T03:14:15.678Z');
  const cutoff = computeCutoffDate(now, 7);
  // Same sub-second precision as `now` — we subtract ms, not days-as-dates.
  assertEqual(cutoff.getUTCMilliseconds(), 678, 'ms preserved');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
