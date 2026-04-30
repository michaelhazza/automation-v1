/**
 * scheduleCalendarServicePure.test.ts — Pure tests for Feature 1.
 *
 * Covers:
 *   - Heartbeat: absolute-interval math, DST invariance, offset, window.
 *   - Cron: delegation to cron-parser, DST wall-clock semantics.
 *   - RRULE: scheduleTime + timezone produces correct UTC occurrences.
 *   - occurrenceId hash determinism.
 *   - sortOccurrences multi-key stable sort.
 *   - estimateTokensPerRun null-history + averaging window.
 *   - validateWindow: ISO, ordering, 30-day ceiling.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/scheduleCalendarServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  computeNextHeartbeatAt,
  projectHeartbeatOccurrences,
  projectCronOccurrences,
  projectRRuleOccurrences,
  zonedWallClockToUtc,
  computeOccurrenceId,
  sortOccurrences,
  estimateTokensPerRun,
  validateWindow,
  SOURCE_PRIORITY,
  MAX_WINDOW_DAYS,
  type ScheduleOccurrence,
} from '../scheduleCalendarServicePure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const ONE_HOUR = 60 * 60 * 1000;
const BASE = {
  subaccountId: 'sa-1',
  subaccountName: 'sa',
  scopeTag: 'subaccount' as const,
};

console.log('\nscheduleCalendarServicePure — Heartbeat\n');

test('computeNextHeartbeatAt: base interval, no offset', () => {
  const next = computeNextHeartbeatAt(0, 1, 0, 0);
  expect(next, 'next').toEqual(ONE_HOUR);
});

test('computeNextHeartbeatAt: mid-interval produces next multiple', () => {
  const next = computeNextHeartbeatAt(90 * 60 * 1000, 1, 0, 0);
  expect(next, 'next').toEqual(2 * ONE_HOUR);
});

test('computeNextHeartbeatAt: offset shifts the lattice', () => {
  expect(computeNextHeartbeatAt(0, 6, 2, 0), '2h').toEqual(2 * ONE_HOUR);
  expect(computeNextHeartbeatAt(3 * ONE_HOUR, 6, 2, 0), '8h after 3h').toEqual(8 * ONE_HOUR);
});

test('computeNextHeartbeatAt: DST invariance — constant interval in UTC', () => {
  const start = Date.UTC(2026, 2, 8, 6, 0, 0);
  const a = computeNextHeartbeatAt(start, 1, 0, 0);
  const b = computeNextHeartbeatAt(a, 1, 0, 0);
  const c = computeNextHeartbeatAt(b, 1, 0, 0);
  expect(a - start, 'first interval').toEqual(ONE_HOUR);
  expect(b - a, 'second interval').toEqual(ONE_HOUR);
  expect(c - b, 'third interval').toEqual(ONE_HOUR);
});

test('projectHeartbeatOccurrences: produces list in window, bounded', () => {
  const start = 0;
  const end = 10 * ONE_HOUR;
  const out = projectHeartbeatOccurrences(
    {
      ...BASE,
      agentId: 'a-1',
      agentName: 'agent',
      intervalHours: 2,
      offsetHours: 0,
      offsetMinutes: 0,
      sourceId: 'a-1',
      sourceName: 'agent',
    },
    start,
    end
  );
  // Inclusive start, exclusive end: fires at 0, 2, 4, 6, 8 — 5 fires (10h excluded).
  expect(out.length, 'count').toBe(5);
  expect(out[0].scheduledAt.getTime(), 'first fire').toBe(0);
  expect(out[4].scheduledAt.getTime(), 'last fire').toEqual(8 * ONE_HOUR);
});

test('projectHeartbeatOccurrences: empty window returns []', () => {
  const out = projectHeartbeatOccurrences(
    {
      ...BASE,
      intervalHours: 1,
      offsetHours: 0,
      offsetMinutes: 0,
      sourceId: 'x',
      sourceName: 'x',
    },
    100,
    100
  );
  expect(out.length, 'empty').toBe(0);
});

test('projectHeartbeatOccurrences: start > end returns []', () => {
  const out = projectHeartbeatOccurrences(
    {
      ...BASE,
      intervalHours: 1,
      offsetHours: 0,
      offsetMinutes: 0,
      sourceId: 'x',
      sourceName: 'x',
    },
    100,
    50
  );
  expect(out.length, 'empty').toBe(0);
});

console.log('\nscheduleCalendarServicePure — Cron\n');

test('projectCronOccurrences: daily at 12:00 UTC — three fires in 3-day window', async () => {
  const start = Date.UTC(2026, 4, 1, 0, 0, 0);
  const end = Date.UTC(2026, 4, 4, 0, 0, 0);
  const out = await projectCronOccurrences(
    {
      ...BASE,
      cronExpression: '0 12 * * *',
      cronTimezone: 'UTC',
      sourceId: 'c-1',
      sourceName: 'c-1',
    },
    start,
    end
  );
  expect(out.length, 'count').toBe(3);
  expect(out[0].scheduledAt.getTime(), 'fire 1').toEqual(Date.UTC(2026, 4, 1, 12, 0, 0));
  expect(out[2].scheduledAt.getTime(), 'fire 3').toEqual(Date.UTC(2026, 4, 3, 12, 0, 0));
});

test('projectCronOccurrences: malformed cron returns [] without throwing', async () => {
  const out = await projectCronOccurrences(
    {
      ...BASE,
      cronExpression: 'not a cron expression',
      cronTimezone: 'UTC',
      sourceId: 'c-1',
      sourceName: 'c-1',
    },
    0,
    ONE_HOUR * 24
  );
  expect(out.length, 'empty').toBe(0);
});

test('projectCronOccurrences: wall-clock DST — UTC hour shifts across DST boundary', async () => {
  // America/New_York DST begins Sunday 2026-03-08 at 02:00 local (→ 03:00).
  // For cron "30 2 * * *" with tz=America/New_York:
  //   Pre-DST (Mar 7, EST, UTC-5): 02:30 NY → 07:30 UTC.
  //   Post-DST (Mar 9, EDT, UTC-4): 02:30 NY → 06:30 UTC.
  // The UTC hour shifting by exactly 1 proves wall-clock-in-tz semantics
  // (same library behaviour pg-boss uses, so projection matches dispatch).
  const start = Date.UTC(2026, 2, 7, 0, 0, 0);
  const end = Date.UTC(2026, 2, 10, 0, 0, 0);
  const out = await projectCronOccurrences(
    {
      ...BASE,
      cronExpression: '30 2 * * *',
      cronTimezone: 'America/New_York',
      sourceId: 'c-dst',
      sourceName: 'c-dst',
    },
    start,
    end
  );
  const preDst = out.find((o) => o.scheduledAt.getUTCDate() === 7);
  const postDst = out.find((o) => o.scheduledAt.getUTCDate() === 9);
  expect(!!preDst, 'pre-DST fire present').toBeTruthy();
  expect(!!postDst, 'post-DST fire present').toBeTruthy();
  expect(preDst!.scheduledAt.getUTCHours(), 'pre-DST fires at 07:30 UTC').toBe(7);
  expect(postDst!.scheduledAt.getUTCHours(), 'post-DST fires at 06:30 UTC').toBe(6);
});

console.log('\nscheduleCalendarServicePure — RRULE\n');

test('zonedWallClockToUtc: UTC round-trip', () => {
  const d = zonedWallClockToUtc(2026, 5, 1, 9, 0, 'UTC');
  expect(d.getTime(), 'UTC midnight').toEqual(Date.UTC(2026, 4, 1, 9, 0, 0));
});

test('zonedWallClockToUtc: America/Los_Angeles PDT', () => {
  const d = zonedWallClockToUtc(2026, 6, 1, 9, 0, 'America/Los_Angeles');
  expect(d.getTime(), 'PDT').toEqual(Date.UTC(2026, 5, 1, 16, 0, 0));
});

test('projectRRuleOccurrences: daily at 09:00 in UTC', async () => {
  const start = Date.UTC(2026, 5, 1, 0, 0, 0);
  const end = Date.UTC(2026, 5, 4, 0, 0, 0);
  const out = await projectRRuleOccurrences(
    {
      ...BASE,
      rrule: 'FREQ=DAILY;INTERVAL=1',
      timezone: 'UTC',
      scheduleTime: '09:00',
      source: 'scheduled_task',
      sourceId: 'st-1',
      sourceName: 'Task',
    },
    start,
    end
  );
  expect(out.length, 'count').toBe(3);
  expect(out[0].scheduledAt.getTime(), 'day 1 fire').toEqual(Date.UTC(2026, 5, 1, 9, 0, 0));
});

console.log('\nscheduleCalendarServicePure — occurrenceId\n');

test('computeOccurrenceId: 128-bit hex, deterministic, source-sensitive', () => {
  const a = computeOccurrenceId('cron', 'c-1', '2026-05-01T12:00:00.000Z');
  const b = computeOccurrenceId('cron', 'c-1', '2026-05-01T12:00:00.000Z');
  const c = computeOccurrenceId('heartbeat', 'c-1', '2026-05-01T12:00:00.000Z');
  expect(a, 'deterministic').toEqual(b);
  expect(a !== c, 'source-sensitive').toBeTruthy();
  expect(a.length, '128-bit prefix').toBe(32);
});

console.log('\nscheduleCalendarServicePure — Sort & totals\n');

function mkOcc(o: Partial<ScheduleOccurrence>): ScheduleOccurrence {
  return {
    occurrenceId: 'x',
    scheduledAt: '2026-05-01T00:00:00Z',
    source: 'cron',
    sourceId: 's',
    sourceName: 's',
    subaccountId: 'sa',
    subaccountName: 'sa',
    runType: 'scheduled',
    estimatedTokens: null,
    estimatedCost: null,
    scopeTag: 'subaccount',
    ...o,
  };
}

test('sortOccurrences: time asc, then source priority, then sourceId lex', () => {
  const items: ScheduleOccurrence[] = [
    mkOcc({ occurrenceId: 'a', scheduledAt: '2026-05-01T10:00:00Z', source: 'cron', sourceId: 'z' }),
    mkOcc({ occurrenceId: 'b', scheduledAt: '2026-05-01T10:00:00Z', source: 'heartbeat', sourceId: 'y' }),
    mkOcc({ occurrenceId: 'c', scheduledAt: '2026-05-01T09:00:00Z', source: 'workflow', sourceId: 'a' }),
    mkOcc({ occurrenceId: 'd', scheduledAt: '2026-05-01T10:00:00Z', source: 'cron', sourceId: 'a' }),
  ];
  const sorted = sortOccurrences(items);
  expect(sorted.map((o) => o.occurrenceId), 'order').toEqual(['c', 'b', 'd', 'a']);
});

test('SOURCE_PRIORITY has unique numeric values per source', () => {
  const vals = Object.values(SOURCE_PRIORITY);
  expect(new Set(vals).size, 'unique').toEqual(vals.length);
  expect(vals.every((v) => typeof v === 'number'), 'numeric').toBeTruthy();
});

console.log('\nscheduleCalendarServicePure — Cost estimator\n');

test('estimateTokensPerRun: <3 samples returns null', () => {
  expect(estimateTokensPerRun([]), 'empty').toBe(null);
  expect(estimateTokensPerRun([
      { promptTokens: 100, completionTokens: 50 },
      { promptTokens: 120, completionTokens: 60 },
    ]), '2 samples').toBe(null);
});

test('estimateTokensPerRun: averages across min(10, N) samples', () => {
  const samples = Array.from({ length: 5 }, (_, i) => ({
    promptTokens: 100 + i * 10,
    completionTokens: 50,
  }));
  // (150 + 160 + 170 + 180 + 190) / 5 = 170
  expect(estimateTokensPerRun(samples), 'avg').toBe(170);
});

test('estimateTokensPerRun: caps window at 10 samples', () => {
  const samples = Array.from({ length: 20 }, () => ({ promptTokens: 100, completionTokens: 50 }));
  expect(estimateTokensPerRun(samples), 'avg is 150').toBe(150);
});

console.log('\nscheduleCalendarServicePure — validateWindow\n');

test('validateWindow: valid ISO, 7-day span passes', () => {
  const r = validateWindow('2026-05-01T00:00:00Z', '2026-05-08T00:00:00Z');
  expect(r.ok, 'ok').toBeTruthy();
  if (r.ok) {
    expect(r.startMs, 'start').toEqual(Date.parse('2026-05-01T00:00:00Z'));
  }
});

test('validateWindow: invalid ISO rejected', () => {
  const r = validateWindow('not-a-date', '2026-05-08T00:00:00Z');
  expect(!r.ok && r.reason === 'invalid_iso', 'invalid').toBeTruthy();
});

test('validateWindow: start >= end rejected', () => {
  const r = validateWindow('2026-05-08T00:00:00Z', '2026-05-01T00:00:00Z');
  expect(!r.ok && r.reason === 'start_not_before_end', 'invalid').toBeTruthy();
});

test('validateWindow: > 30-day span rejected', () => {
  const r = validateWindow('2026-05-01T00:00:00Z', '2026-06-10T00:00:00Z');
  expect(!r.ok && r.reason === 'window_too_large', 'invalid').toBeTruthy();
  expect(MAX_WINDOW_DAYS, 'ceiling').toBe(30);
});

console.log('');
