/**
 * Pure translation — SchedulePickerValue → cron expression + first-run UTC.
 *
 * Spec: docs/onboarding-playbooks-spec.md §5.3.
 *
 * Emits a 5-field cron expression compatible with pg-boss's node-cron parser:
 *   "minute hour day-of-month month day-of-week"
 *
 * All timezone handling happens here so the caller only ever deals in
 * `SchedulePickerValue`. The function is pure (no I/O, no globals, no Date.now
 * unless `nowUtc` is omitted — in which case the caller is accepting system
 * time and the function is still referentially transparent for any fixed
 * `nowUtc`).
 *
 * No I/O. No imports beyond the shared `SchedulePickerValue` type.
 *
 * DST correctness: the cron is registered for the wall-clock time in the
 * subaccount timezone. pg-boss's cron scheduler treats that as a local time
 * and applies the target timezone's DST rules automatically when passed with
 * a `tz` option. For `firstRunAt` we compute UTC from the zoned wall-clock
 * via the same `Intl.DateTimeFormat` trick used by the existing
 * `scheduledTaskService.zonedWallClockToUtc` helper.
 */

export type SchedulePickerInterval =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'half_yearly'
  | 'annually';

export interface SchedulePickerValue {
  interval: SchedulePickerInterval;
  /** ISO date-time in subaccount timezone wall-clock — e.g. "2026-04-15T09:00". */
  firstRunAt: string;
  /** HH:mm 24h. Required for daily / weekly / monthly. */
  timeOfDay?: string;
  /** 0-6 Sun-Sat. Required for weekly. */
  dayOfWeek?: number;
  /** 1-31. Required for monthly. */
  dayOfMonth?: number;
  /** Universal flag — fire an immediate run in addition to the cron. */
  runNow: boolean;
}

export interface SchedulePickerCronOutput {
  /** 5-field cron for pg-boss's node-cron. */
  cron: string;
  /** First cron firing time, as a UTC Date. */
  firstRunAt: Date;
  /** IANA timezone label the original value was expressed in. */
  firstRunAtTz: string;
}

export class SchedulePickerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SchedulePickerError';
    this.code = code;
  }
}

// ─── Zoned wall-clock → UTC ─────────────────────────────────────────────────
// Uses the Intl API to determine the target timezone's UTC offset for the
// given instant. Correct across DST boundaries because the offset is computed
// for the target instant, not the system instant.

function zonedWallClockToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(naiveUtc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const projected = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  const offset = projected - naiveUtc;
  return new Date(naiveUtc - offset);
}

// ─── Input parsing ──────────────────────────────────────────────────────────

function parseTimeOfDay(
  timeOfDay: string | undefined,
  fallback: { hour: number; minute: number },
): { hour: number; minute: number } {
  if (!timeOfDay) return fallback;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(timeOfDay);
  if (!m) {
    throw new SchedulePickerError(
      'invalid_time_of_day',
      `timeOfDay must be HH:mm 24h; got '${timeOfDay}'`,
    );
  }
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function parseFirstRunAt(iso: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  // We deliberately do NOT use `new Date(iso)` here because the caller's
  // ISO string is a wall-clock value in the subaccount timezone, not UTC.
  // Creating a `Date` would reinterpret it in the Node process's local tz.
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?/.exec(iso);
  if (!m) {
    throw new SchedulePickerError(
      'invalid_first_run_at',
      `firstRunAt must be ISO date-time; got '${iso}'`,
    );
  }
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: m[4] ? Number(m[4]) : 0,
    minute: m[5] ? Number(m[5]) : 0,
  };
}

// ─── Cron emission per interval ─────────────────────────────────────────────

function buildCron(
  v: SchedulePickerValue,
  hour: number,
  minute: number,
  firstRunDay: number,
  firstRunMonth: number,
): string {
  switch (v.interval) {
    case 'daily':
      // Every day at HH:MM.
      return `${minute} ${hour} * * *`;
    case 'weekly': {
      const dow = v.dayOfWeek ?? 1;
      if (dow < 0 || dow > 6) {
        throw new SchedulePickerError(
          'invalid_day_of_week',
          `dayOfWeek must be 0-6; got ${dow}`,
        );
      }
      return `${minute} ${hour} * * ${dow}`;
    }
    case 'monthly': {
      const dom = v.dayOfMonth ?? firstRunDay;
      if (dom < 1 || dom > 31) {
        throw new SchedulePickerError(
          'invalid_day_of_month',
          `dayOfMonth must be 1-31; got ${dom}`,
        );
      }
      // Cap at 28 per spec §5.1 ("max 28; higher values fall back to last
      // day of month with a note"). pg-boss node-cron supports the "L"
      // token, but we stay portable by clamping and letting the UI surface
      // the fallback note.
      const clamped = dom > 28 ? 28 : dom;
      return `${minute} ${hour} ${clamped} * *`;
    }
    case 'quarterly': {
      // Fire on the first-run day, every 3 months starting from the
      // first-run month. Produces a 4-month list (e.g. Jan/Apr/Jul/Oct
      // when first run is in January).
      const months: number[] = [];
      for (let i = 0; i < 4; i++) {
        months.push(((firstRunMonth - 1 + i * 3) % 12) + 1);
      }
      months.sort((a, b) => a - b);
      const clamped = firstRunDay > 28 ? 28 : firstRunDay;
      return `${minute} ${hour} ${clamped} ${months.join(',')} *`;
    }
    case 'half_yearly': {
      // Fire on the first-run day, every 6 months.
      const a = firstRunMonth;
      const b = ((firstRunMonth - 1 + 6) % 12) + 1;
      const months = [a, b].sort((x, y) => x - y);
      const clamped = firstRunDay > 28 ? 28 : firstRunDay;
      return `${minute} ${hour} ${clamped} ${months.join(',')} *`;
    }
    case 'annually': {
      const clamped = firstRunDay > 28 ? 28 : firstRunDay;
      return `${minute} ${hour} ${clamped} ${firstRunMonth} *`;
    }
    default: {
      // Exhaustive guard — unreachable in TS but the runtime check catches
      // a renderer that writes an unknown interval.
      const bad: never = v.interval;
      throw new SchedulePickerError(
        'invalid_interval',
        `unknown interval '${String(bad)}'`,
      );
    }
  }
}

/**
 * Translate a `SchedulePickerValue` + subaccount timezone into a pg-boss
 * cron expression and the first UTC firing time.
 *
 * Returns a `{ cron, firstRunAt, firstRunAtTz }` triple. Throws
 * `SchedulePickerError` on malformed inputs.
 */
export function schedulePickerValueToCron(
  v: SchedulePickerValue,
  subaccountTimezone: string,
): SchedulePickerCronOutput {
  if (!subaccountTimezone || typeof subaccountTimezone !== 'string') {
    throw new SchedulePickerError(
      'invalid_timezone',
      `subaccountTimezone must be a non-empty IANA label`,
    );
  }

  const parsed = parseFirstRunAt(v.firstRunAt);
  const tod =
    v.interval === 'daily' ||
    v.interval === 'weekly' ||
    v.interval === 'monthly'
      ? parseTimeOfDay(v.timeOfDay, { hour: parsed.hour, minute: parsed.minute })
      : { hour: parsed.hour, minute: parsed.minute };

  // Compute first run UTC from the zoned wall-clock. For intervals that
  // declare timeOfDay explicitly (daily/weekly/monthly) we use that; for
  // the longer intervals we use the firstRunAt's embedded time component.
  const firstRunUtc = zonedWallClockToUtc(
    parsed.year,
    parsed.month,
    parsed.day,
    tod.hour,
    tod.minute,
    subaccountTimezone,
  );

  const cron = buildCron(v, tod.hour, tod.minute, parsed.day, parsed.month);

  return {
    cron,
    firstRunAt: firstRunUtc,
    firstRunAtTz: subaccountTimezone,
  };
}

/**
 * Seeds a default `SchedulePickerValue` when the caller has nothing to start
 * from. Spec §5.7 — picker never renders empty. Daily, 09:00, starting
 * today (or tomorrow if 09:00 has already passed).
 *
 * Pure given `nowUtc`. The component seeds with `new Date()` on mount and
 * then stays pure for the remainder of its lifetime.
 */
export function defaultSchedulePickerValue(
  nowUtc: Date,
  subaccountTimezone: string,
): SchedulePickerValue {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: subaccountTimezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = dtf.formatToParts(nowUtc);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));
  const h = Number(get('hour'));

  // If today's 09:00 has already passed in the target tz, roll to tomorrow.
  let year = y;
  let month = m;
  let day = d;
  if (h >= 9) {
    const next = zonedWallClockToUtc(y, m, d + 1, 9, 0, subaccountTimezone);
    const nextParts = dtf.formatToParts(next);
    const ng = (t: string) => Number(nextParts.find((p) => p.type === t)!.value);
    year = ng('year');
    month = ng('month');
    day = ng('day');
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    interval: 'daily',
    firstRunAt: `${year}-${pad(month)}-${pad(day)}T09:00`,
    timeOfDay: '09:00',
    runNow: false,
  };
}

/**
 * Human-readable summary for the picker's bottom-line preview.
 * Spec §5.1 item 5.
 */
export function describeSchedulePickerValue(
  v: SchedulePickerValue,
  subaccountTimezone: string,
): string {
  const parts: string[] = [];
  const tod = v.timeOfDay ?? '09:00';

  switch (v.interval) {
    case 'daily':
      parts.push(`Every day at ${tod}`);
      break;
    case 'weekly': {
      const days = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ];
      parts.push(`Every ${days[v.dayOfWeek ?? 1]} at ${tod}`);
      break;
    }
    case 'monthly':
      parts.push(`On day ${v.dayOfMonth ?? 1} of each month at ${tod}`);
      break;
    case 'quarterly':
      parts.push(`Every 3 months`);
      break;
    case 'half_yearly':
      parts.push(`Every 6 months`);
      break;
    case 'annually':
      parts.push(`Once a year`);
      break;
  }

  parts.push(`(${subaccountTimezone})`);
  parts.push(`starting ${v.firstRunAt.slice(0, 10)}`);

  if (v.runNow) parts.push(`— will run immediately on save`);
  return parts.join(' ');
}
