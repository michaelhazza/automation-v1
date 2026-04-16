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

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}
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

await test('computeNextHeartbeatAt: base interval, no offset', () => {
  const next = computeNextHeartbeatAt(0, 1, 0, 0);
  assertEqual(next, ONE_HOUR, 'next');
});

await test('computeNextHeartbeatAt: mid-interval produces next multiple', () => {
  const next = computeNextHeartbeatAt(90 * 60 * 1000, 1, 0, 0);
  assertEqual(next, 2 * ONE_HOUR, 'next');
});

await test('computeNextHeartbeatAt: offset shifts the lattice', () => {
  assertEqual(computeNextHeartbeatAt(0, 6, 2, 0), 2 * ONE_HOUR, '2h');
  assertEqual(computeNextHeartbeatAt(3 * ONE_HOUR, 6, 2, 0), 8 * ONE_HOUR, '8h after 3h');
});

await test('computeNextHeartbeatAt: DST invariance — constant interval in UTC', () => {
  const start = Date.UTC(2026, 2, 8, 6, 0, 0);
  const a = computeNextHeartbeatAt(start, 1, 0, 0);
  const b = computeNextHeartbeatAt(a, 1, 0, 0);
  const c = computeNextHeartbeatAt(b, 1, 0, 0);
  assertEqual(a - start, ONE_HOUR, 'first interval');
  assertEqual(b - a, ONE_HOUR, 'second interval');
  assertEqual(c - b, ONE_HOUR, 'third interval');
});

await test('projectHeartbeatOccurrences: produces list in window, bounded', () => {
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
  assertEqual(out.length, 5, 'count');
  assertEqual(out[0].scheduledAt.getTime(), 0, 'first fire');
  assertEqual(out[4].scheduledAt.getTime(), 8 * ONE_HOUR, 'last fire');
});

await test('projectHeartbeatOccurrences: empty window returns []', () => {
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
  assertEqual(out.length, 0, 'empty');
});

await test('projectHeartbeatOccurrences: start > end returns []', () => {
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
  assertEqual(out.length, 0, 'empty');
});

console.log('\nscheduleCalendarServicePure — Cron\n');

await test('projectCronOccurrences: daily at 12:00 UTC — three fires in 3-day window', async () => {
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
  assertEqual(out.length, 3, 'count');
  assertEqual(out[0].scheduledAt.getTime(), Date.UTC(2026, 4, 1, 12, 0, 0), 'fire 1');
  assertEqual(out[2].scheduledAt.getTime(), Date.UTC(2026, 4, 3, 12, 0, 0), 'fire 3');
});

await test('projectCronOccurrences: malformed cron returns [] without throwing', async () => {
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
  assertEqual(out.length, 0, 'empty');
});

await test('projectCronOccurrences: wall-clock DST — UTC hour shifts across DST boundary', async () => {
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
  assert(!!preDst, 'pre-DST fire present');
  assert(!!postDst, 'post-DST fire present');
  assertEqual(preDst!.scheduledAt.getUTCHours(), 7, 'pre-DST fires at 07:30 UTC');
  assertEqual(postDst!.scheduledAt.getUTCHours(), 6, 'post-DST fires at 06:30 UTC');
});

console.log('\nscheduleCalendarServicePure — RRULE\n');

await test('zonedWallClockToUtc: UTC round-trip', () => {
  const d = zonedWallClockToUtc(2026, 5, 1, 9, 0, 'UTC');
  assertEqual(d.getTime(), Date.UTC(2026, 4, 1, 9, 0, 0), 'UTC midnight');
});

await test('zonedWallClockToUtc: America/Los_Angeles PDT', () => {
  const d = zonedWallClockToUtc(2026, 6, 1, 9, 0, 'America/Los_Angeles');
  assertEqual(d.getTime(), Date.UTC(2026, 5, 1, 16, 0, 0), 'PDT');
});

await test('projectRRuleOccurrences: daily at 09:00 in UTC', async () => {
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
  assertEqual(out.length, 3, 'count');
  assertEqual(out[0].scheduledAt.getTime(), Date.UTC(2026, 5, 1, 9, 0, 0), 'day 1 fire');
});

console.log('\nscheduleCalendarServicePure — occurrenceId\n');

await test('computeOccurrenceId: 128-bit hex, deterministic, source-sensitive', () => {
  const a = computeOccurrenceId('cron', 'c-1', '2026-05-01T12:00:00.000Z');
  const b = computeOccurrenceId('cron', 'c-1', '2026-05-01T12:00:00.000Z');
  const c = computeOccurrenceId('heartbeat', 'c-1', '2026-05-01T12:00:00.000Z');
  assertEqual(a, b, 'deterministic');
  assert(a !== c, 'source-sensitive');
  assertEqual(a.length, 32, '128-bit prefix');
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

await test('sortOccurrences: time asc, then source priority, then sourceId lex', () => {
  const items: ScheduleOccurrence[] = [
    mkOcc({ occurrenceId: 'a', scheduledAt: '2026-05-01T10:00:00Z', source: 'cron', sourceId: 'z' }),
    mkOcc({ occurrenceId: 'b', scheduledAt: '2026-05-01T10:00:00Z', source: 'heartbeat', sourceId: 'y' }),
    mkOcc({ occurrenceId: 'c', scheduledAt: '2026-05-01T09:00:00Z', source: 'playbook', sourceId: 'a' }),
    mkOcc({ occurrenceId: 'd', scheduledAt: '2026-05-01T10:00:00Z', source: 'cron', sourceId: 'a' }),
  ];
  const sorted = sortOccurrences(items);
  assertEqual(sorted.map((o) => o.occurrenceId), ['c', 'b', 'd', 'a'], 'order');
});

await test('SOURCE_PRIORITY has unique numeric values per source', () => {
  const vals = Object.values(SOURCE_PRIORITY);
  assertEqual(new Set(vals).size, vals.length, 'unique');
  assert(vals.every((v) => typeof v === 'number'), 'numeric');
});

console.log('\nscheduleCalendarServicePure — Cost estimator\n');

await test('estimateTokensPerRun: <3 samples returns null', () => {
  assertEqual(estimateTokensPerRun([]), null, 'empty');
  assertEqual(
    estimateTokensPerRun([
      { promptTokens: 100, completionTokens: 50 },
      { promptTokens: 120, completionTokens: 60 },
    ]),
    null,
    '2 samples'
  );
});

await test('estimateTokensPerRun: averages across min(10, N) samples', () => {
  const samples = Array.from({ length: 5 }, (_, i) => ({
    promptTokens: 100 + i * 10,
    completionTokens: 50,
  }));
  // (150 + 160 + 170 + 180 + 190) / 5 = 170
  assertEqual(estimateTokensPerRun(samples), 170, 'avg');
});

await test('estimateTokensPerRun: caps window at 10 samples', () => {
  const samples = Array.from({ length: 20 }, () => ({ promptTokens: 100, completionTokens: 50 }));
  assertEqual(estimateTokensPerRun(samples), 150, 'avg is 150');
});

console.log('\nscheduleCalendarServicePure — validateWindow\n');

await test('validateWindow: valid ISO, 7-day span passes', () => {
  const r = validateWindow('2026-05-01T00:00:00Z', '2026-05-08T00:00:00Z');
  assert(r.ok, 'ok');
  if (r.ok) {
    assertEqual(r.startMs, Date.parse('2026-05-01T00:00:00Z'), 'start');
  }
});

await test('validateWindow: invalid ISO rejected', () => {
  const r = validateWindow('not-a-date', '2026-05-08T00:00:00Z');
  assert(!r.ok && r.reason === 'invalid_iso', 'invalid');
});

await test('validateWindow: start >= end rejected', () => {
  const r = validateWindow('2026-05-08T00:00:00Z', '2026-05-01T00:00:00Z');
  assert(!r.ok && r.reason === 'start_not_before_end', 'invalid');
});

await test('validateWindow: > 30-day span rejected', () => {
  const r = validateWindow('2026-05-01T00:00:00Z', '2026-06-10T00:00:00Z');
  assert(!r.ok && r.reason === 'window_too_large', 'invalid');
  assertEqual(MAX_WINDOW_DAYS, 30, 'ceiling');
});

console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
