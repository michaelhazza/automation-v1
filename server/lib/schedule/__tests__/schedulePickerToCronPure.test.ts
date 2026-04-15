/**
 * schedulePickerValueToCron pure unit tests — runnable via:
 *   npx tsx server/lib/schedule/__tests__/schedulePickerToCronPure.test.ts
 *
 * Covers every interval × DST boundary × end-of-month edge case per
 * docs/onboarding-playbooks-spec.md §5.3.
 */

import {
  schedulePickerValueToCron,
  defaultSchedulePickerValue,
  describeSchedulePickerValue,
  SchedulePickerError,
  type SchedulePickerValue,
} from '../schedulePickerToCron.js';

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

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── Daily ──────────────────────────────────────────────────────────────────

test('daily — emits "M H * * *" cron', () => {
  const v: SchedulePickerValue = {
    interval: 'daily',
    firstRunAt: '2026-04-15T09:00',
    timeOfDay: '09:00',
    runNow: false,
  };
  const out = schedulePickerValueToCron(v, 'UTC');
  assertEqual(out.cron, '0 9 * * *', 'daily cron');
  assertEqual(out.firstRunAtTz, 'UTC', 'tz preserved');
});

test('daily — non-UTC tz converts wall-clock correctly (EST -05:00 in Jan)', () => {
  // Jan is standard time in NY: UTC-05:00. 09:00 NY = 14:00 UTC.
  const v: SchedulePickerValue = {
    interval: 'daily',
    firstRunAt: '2026-01-15T09:00',
    timeOfDay: '09:00',
    runNow: false,
  };
  const out = schedulePickerValueToCron(v, 'America/New_York');
  assertEqual(out.firstRunAt.toISOString(), '2026-01-15T14:00:00.000Z', 'EST offset');
});

test('daily — non-UTC tz converts wall-clock correctly (EDT -04:00 in Jul)', () => {
  // Jul is DST in NY: UTC-04:00. 09:00 NY = 13:00 UTC.
  const v: SchedulePickerValue = {
    interval: 'daily',
    firstRunAt: '2026-07-15T09:00',
    timeOfDay: '09:00',
    runNow: false,
  };
  const out = schedulePickerValueToCron(v, 'America/New_York');
  assertEqual(out.firstRunAt.toISOString(), '2026-07-15T13:00:00.000Z', 'EDT offset');
});

test('daily — DST transition day (Mar 8 2026 NY): 09:00 local is 13:00 UTC', () => {
  // 2026-03-08 02:00 -> 03:00 in NY. 09:00 is comfortably past the gap.
  const v: SchedulePickerValue = {
    interval: 'daily',
    firstRunAt: '2026-03-08T09:00',
    timeOfDay: '09:00',
    runNow: false,
  };
  const out = schedulePickerValueToCron(v, 'America/New_York');
  assertEqual(out.firstRunAt.toISOString(), '2026-03-08T13:00:00.000Z', 'DST forward');
});

// ─── Weekly ─────────────────────────────────────────────────────────────────

test('weekly — emits "M H * * D" cron for Monday 9am', () => {
  const v: SchedulePickerValue = {
    interval: 'weekly',
    firstRunAt: '2026-04-20T09:00', // Monday
    timeOfDay: '09:00',
    dayOfWeek: 1, // Monday
    runNow: false,
  };
  const out = schedulePickerValueToCron(v, 'UTC');
  assertEqual(out.cron, '0 9 * * 1', 'weekly Monday cron');
});

test('weekly — Sunday = 0', () => {
  const v: SchedulePickerValue = {
    interval: 'weekly',
    firstRunAt: '2026-04-19T10:30', // Sunday
    timeOfDay: '10:30',
    dayOfWeek: 0,
    runNow: false,
  };
  const out = schedulePickerValueToCron(v, 'UTC');
  assertEqual(out.cron, '30 10 * * 0', 'weekly Sunday cron');
});

test('weekly — rejects invalid dayOfWeek', () => {
  const v: SchedulePickerValue = {
    interval: 'weekly',
    firstRunAt: '2026-04-20T09:00',
    timeOfDay: '09:00',
    dayOfWeek: 7,
    runNow: false,
  };
  let threw = false;
  try {
    schedulePickerValueToCron(v, 'UTC');
  } catch (err) {
    threw = err instanceof SchedulePickerError && err.code === 'invalid_day_of_week';
  }
  assert(threw, 'dayOfWeek=7 must throw invalid_day_of_week');
});

// ─── Monthly ────────────────────────────────────────────────────────────────

test('monthly — emits "M H D * *" cron', () => {
  const v: SchedulePickerValue = {
    interval: 'monthly',
    firstRunAt: '2026-04-15T09:00',
    timeOfDay: '09:00',
    dayOfMonth: 15,
    runNow: false,
  };
  const out = schedulePickerValueToCron(v, 'UTC');
  assertEqual(out.cron, '0 9 15 * *', 'monthly cron');
});

test('monthly — day 29+ clamps to 28 (spec fallback for short months)', () => {
  const v: SchedulePickerValue = {
    interval: 'monthly',
    firstRunAt: '2026-04-30T09:00',
    timeOfDay: '09:00',
    dayOfMonth: 31,
    runNow: false,
  };
  const out = schedulePickerValueToCron(v, 'UTC');
  assertEqual(out.cron, '0 9 28 * *', 'monthly cron clamped at 28');
});

test('monthly — rejects invalid dayOfMonth=0', () => {
  const v: SchedulePickerValue = {
    interval: 'monthly',
    firstRunAt: '2026-04-01T09:00',
    timeOfDay: '09:00',
    dayOfMonth: 0,
    runNow: false,
  };
  let threw = false;
  try {
    schedulePickerValueToCron(v, 'UTC');
  } catch (err) {
    threw = err instanceof SchedulePickerError && err.code === 'invalid_day_of_month';
  }
  assert(threw, 'dayOfMonth=0 must throw invalid_day_of_month');
});

// ─── Quarterly ──────────────────────────────────────────────────────────────

test('quarterly — emits 4-month list starting from first-run month', () => {
  const v: SchedulePickerValue = {
    interval: 'quarterly',
    firstRunAt: '2026-01-15T09:00',
    runNow: false,
  };
  const out = schedulePickerValueToCron(v, 'UTC');
  // Jan start → Jan, Apr, Jul, Oct
  assertEqual(out.cron, '0 9 15 1,4,7,10 *', 'quarterly from Jan');
});

test('quarterly — Feb start wraps to May/Aug/Nov/Feb', () => {
  const v: SchedulePickerValue = {
    interval: 'quarterly',
    firstRunAt: '2026-02-10T08:30',
    runNow: false,
  };
  const out = schedulePickerValueToCron(v, 'UTC');
  assertEqual(out.cron, '30 8 10 2,5,8,11 *', 'quarterly from Feb');
});

// ─── Half-yearly ────────────────────────────────────────────────────────────

test('half_yearly — emits 2-month list 6 apart', () => {
  const v: SchedulePickerValue = {
    interval: 'half_yearly',
    firstRunAt: '2026-03-20T14:00',
    runNow: false,
  };
  const out = schedulePickerValueToCron(v, 'UTC');
  assertEqual(out.cron, '0 14 20 3,9 *', 'half-yearly Mar/Sep');
});

test('half_yearly — December wraps to June', () => {
  const v: SchedulePickerValue = {
    interval: 'half_yearly',
    firstRunAt: '2026-12-05T12:00',
    runNow: false,
  };
  const out = schedulePickerValueToCron(v, 'UTC');
  assertEqual(out.cron, '0 12 5 6,12 *', 'half-yearly Jun/Dec');
});

// ─── Annually ───────────────────────────────────────────────────────────────

test('annually — emits single-month cron', () => {
  const v: SchedulePickerValue = {
    interval: 'annually',
    firstRunAt: '2026-05-10T11:15',
    runNow: false,
  };
  const out = schedulePickerValueToCron(v, 'UTC');
  assertEqual(out.cron, '15 11 10 5 *', 'annually cron');
});

test('annually — day 31 clamps to 28', () => {
  const v: SchedulePickerValue = {
    interval: 'annually',
    firstRunAt: '2026-03-31T09:00',
    runNow: false,
  };
  const out = schedulePickerValueToCron(v, 'UTC');
  assertEqual(out.cron, '0 9 28 3 *', 'annual clamp');
});

// ─── Input validation ──────────────────────────────────────────────────────

test('rejects malformed firstRunAt', () => {
  const v: SchedulePickerValue = {
    interval: 'daily',
    firstRunAt: 'not-a-date',
    timeOfDay: '09:00',
    runNow: false,
  };
  let threw = false;
  try {
    schedulePickerValueToCron(v, 'UTC');
  } catch (err) {
    threw = err instanceof SchedulePickerError && err.code === 'invalid_first_run_at';
  }
  assert(threw, 'bad firstRunAt must throw');
});

test('rejects malformed timeOfDay', () => {
  const v: SchedulePickerValue = {
    interval: 'daily',
    firstRunAt: '2026-04-15T09:00',
    timeOfDay: '25:00',
    runNow: false,
  };
  let threw = false;
  try {
    schedulePickerValueToCron(v, 'UTC');
  } catch (err) {
    threw = err instanceof SchedulePickerError && err.code === 'invalid_time_of_day';
  }
  assert(threw, 'bad timeOfDay must throw');
});

test('rejects empty timezone', () => {
  const v: SchedulePickerValue = {
    interval: 'daily',
    firstRunAt: '2026-04-15T09:00',
    timeOfDay: '09:00',
    runNow: false,
  };
  let threw = false;
  try {
    schedulePickerValueToCron(v, '');
  } catch (err) {
    threw = err instanceof SchedulePickerError && err.code === 'invalid_timezone';
  }
  assert(threw, 'empty tz must throw');
});

// ─── defaultSchedulePickerValue ─────────────────────────────────────────────

test('defaultSchedulePickerValue seeds daily 09:00 — today when before 9am local', () => {
  // 06:00 UTC on 2026-04-15 is 02:00 NY — well before 9am NY.
  const now = new Date('2026-04-15T06:00:00Z');
  const v = defaultSchedulePickerValue(now, 'America/New_York');
  assertEqual(v.interval, 'daily', 'default interval');
  assertEqual(v.timeOfDay, '09:00', 'default time');
  assertEqual(v.runNow, false, 'default runNow');
  assertEqual(v.firstRunAt, '2026-04-15T09:00', 'first run today');
});

test('defaultSchedulePickerValue rolls to tomorrow when after 9am local', () => {
  // 18:00 UTC on 2026-04-15 is 14:00 NY — past 09:00.
  const now = new Date('2026-04-15T18:00:00Z');
  const v = defaultSchedulePickerValue(now, 'America/New_York');
  assertEqual(v.firstRunAt, '2026-04-16T09:00', 'rolls to tomorrow');
});

// ─── describeSchedulePickerValue ────────────────────────────────────────────

test('describe — daily with runNow', () => {
  const v: SchedulePickerValue = {
    interval: 'daily',
    firstRunAt: '2026-04-15T09:00',
    timeOfDay: '09:00',
    runNow: true,
  };
  const s = describeSchedulePickerValue(v, 'America/New_York');
  assert(s.includes('Every day at 09:00'), `summary mentions schedule: ${s}`);
  assert(s.includes('America/New_York'), `summary mentions tz: ${s}`);
  assert(s.includes('immediately'), `summary mentions runNow: ${s}`);
});

test('describe — weekly without runNow', () => {
  const v: SchedulePickerValue = {
    interval: 'weekly',
    firstRunAt: '2026-04-20T09:00',
    timeOfDay: '09:00',
    dayOfWeek: 1,
    runNow: false,
  };
  const s = describeSchedulePickerValue(v, 'UTC');
  assert(s.includes('Monday'), `summary mentions weekday: ${s}`);
  assert(!s.includes('immediately'), `no runNow phrasing when off: ${s}`);
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
