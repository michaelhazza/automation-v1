import { useEffect, useRef } from 'react';
import { HelpHint } from './ui/HelpHint';

// ---------------------------------------------------------------------------
// SchedulePicker — Universal recurrence picker
// Spec: docs/onboarding-playbooks-spec.md §5.1
//
// Emits a `SchedulePickerValue` — never a raw cron string. Server-side
// helper `schedulePickerValueToCron` converts at the boundary. Keeps
// timezone + DST rules server-side where they can be tested exhaustively.
// ---------------------------------------------------------------------------

export type SchedulePickerInterval =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'half_yearly'
  | 'annually';

export interface SchedulePickerValue {
  interval: SchedulePickerInterval;
  firstRunAt: string;       // ISO date-time, subaccount tz wall-clock
  timeOfDay?: string;       // HH:mm 24h
  dayOfWeek?: number;       // 0-6 Sun-Sat
  dayOfMonth?: number;      // 1-31
  runNow: boolean;
}

export interface SchedulePickerProps {
  value: SchedulePickerValue | null;
  onChange: (v: SchedulePickerValue) => void;
  subaccountTimezone: string;
  allowRunNow?: boolean;
  helpText?: string;
  disabled?: boolean;
}

const INTERVAL_LABELS: Record<SchedulePickerInterval, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Every 6 months',
  annually: 'Yearly',
};

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

function todayInTz(timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

function seedDefault(timeZone: string): SchedulePickerValue {
  return {
    interval: 'daily',
    firstRunAt: `${todayInTz(timeZone)}T09:00`,
    timeOfDay: '09:00',
    runNow: false,
  };
}

function summarise(v: SchedulePickerValue, tz: string): string {
  const parts: string[] = [];
  const tod = v.timeOfDay ?? '09:00';
  switch (v.interval) {
    case 'daily':
      parts.push(`Every day at ${tod}`);
      break;
    case 'weekly': {
      const label = DAYS_OF_WEEK[v.dayOfWeek ?? 1]?.label ?? 'Monday';
      parts.push(`Every ${label} at ${tod}`);
      break;
    }
    case 'monthly':
      parts.push(`On day ${v.dayOfMonth ?? 1} of each month at ${tod}`);
      break;
    case 'quarterly':
      parts.push('Every 3 months');
      break;
    case 'half_yearly':
      parts.push('Every 6 months');
      break;
    case 'annually':
      parts.push('Once a year');
      break;
  }
  parts.push(`(${tz})`);
  parts.push(`starting ${v.firstRunAt.slice(0, 10)}`);
  if (v.runNow) parts.push('— will run immediately on save');
  return parts.join(' ');
}

export function SchedulePicker(props: SchedulePickerProps) {
  const { value, onChange, subaccountTimezone, allowRunNow = true, helpText, disabled } = props;

  // Seed a default exactly once if `value` arrives null — spec §5.7.
  const seeded = useRef(false);
  useEffect(() => {
    if (value === null && !seeded.current) {
      seeded.current = true;
      onChange(seedDefault(subaccountTimezone));
    }
    // Intentionally exclude onChange from deps — parents commonly pass
    // fresh closures every render, and re-seeding on every render would
    // swallow user edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, subaccountTimezone]);

  if (value === null) {
    // One-frame render while default seeds.
    return <div className="text-sm text-slate-400">Loading schedule…</div>;
  }

  function patch(p: Partial<SchedulePickerValue>) {
    onChange({ ...value!, ...p });
  }

  function setInterval(next: SchedulePickerInterval) {
    // Drop fields that no longer apply; seed fields that do.
    const base: SchedulePickerValue = {
      ...value!,
      interval: next,
      dayOfWeek: undefined,
      dayOfMonth: undefined,
    };
    if (next === 'weekly') {
      base.dayOfWeek = value!.dayOfWeek ?? 1;
      base.timeOfDay = value!.timeOfDay ?? '09:00';
    } else if (next === 'monthly') {
      const dom = Number(value!.firstRunAt.slice(8, 10)) || 1;
      base.dayOfMonth = value!.dayOfMonth ?? dom;
      base.timeOfDay = value!.timeOfDay ?? '09:00';
    } else if (next === 'daily') {
      base.timeOfDay = value!.timeOfDay ?? '09:00';
    }
    onChange(base);
  }

  const usesTimeOfDay =
    value.interval === 'daily' ||
    value.interval === 'weekly' ||
    value.interval === 'monthly';

  return (
    <div className="space-y-4">
      {helpText && (
        <div className="text-sm text-slate-600">{helpText}</div>
      )}

      {/* 1. Interval */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Interval
        </label>
        <select
          value={value.interval}
          onChange={(e) => setInterval(e.target.value as SchedulePickerInterval)}
          disabled={disabled}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
        >
          {(Object.keys(INTERVAL_LABELS) as SchedulePickerInterval[]).map((k) => (
            <option key={k} value={k}>
              {INTERVAL_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      {/* 2. Frequency modifiers */}
      {value.interval === 'weekly' && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Day of week
          </label>
          <div className="flex gap-1.5">
            {DAYS_OF_WEEK.map((d) => {
              const active = value.dayOfWeek === d.value;
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => patch({ dayOfWeek: d.value })}
                  disabled={disabled}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    active
                      ? 'bg-indigo-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {value.interval === 'monthly' && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Day of month
          </label>
          <input
            type="number"
            min={1}
            max={31}
            value={value.dayOfMonth ?? 1}
            onChange={(e) => patch({ dayOfMonth: Number(e.target.value) || 1 })}
            disabled={disabled}
            className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
          />
          {(value.dayOfMonth ?? 0) > 28 && (
            <div className="text-xs text-slate-500 mt-1">
              Days 29–31 fall back to the 28th to avoid skipping short months.
            </div>
          )}
        </div>
      )}

      {usesTimeOfDay && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Time of day
          </label>
          <input
            type="time"
            value={value.timeOfDay ?? '09:00'}
            onChange={(e) => patch({ timeOfDay: e.target.value })}
            disabled={disabled}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
          />
        </div>
      )}

      {/* 3. First run date */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          First run
        </label>
        <input
          type="date"
          value={value.firstRunAt.slice(0, 10)}
          onChange={(e) => {
            const tod = value.timeOfDay ?? '09:00';
            patch({ firstRunAt: `${e.target.value}T${tod}` });
          }}
          disabled={disabled}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
        />
        <div className="text-xs text-slate-500 mt-1">
          Times are in {subaccountTimezone}.
        </div>
      </div>

      {/* 4. Run now */}
      {allowRunNow && (
        <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={value.runNow}
            onChange={(e) => patch({ runNow: e.target.checked })}
            disabled={disabled}
            className="mt-0.5 w-4 h-4 accent-indigo-500"
          />
          <span className="flex-1">
            <span className="inline-flex items-center gap-1">
              Run now and keep the schedule
              <HelpHint text="Kicks off the first run immediately after saving. The recurring schedule continues as configured." />
            </span>
          </span>
        </label>
      )}

      {/* 5. Summary */}
      <div className="text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
        {summarise(value, subaccountTimezone)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bridge helper — translates SchedulePickerValue to the existing
// RRULE/scheduleTime/timezone shape that the v1 scheduled-task backend
// already accepts. Kept alongside the component so callers that adopt
// SchedulePicker against the legacy API have a one-liner migration.
// Matches server/lib/schedule/schedulePickerToCron.ts for cron, plus
// returns the RRULE string for pre-SchedulePicker services.
// ---------------------------------------------------------------------------

const DOW_TO_RRULE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export interface RruleBridgeOutput {
  rrule: string;
  scheduleTime: string;
  timezone: string;
}

export function schedulePickerValueToRrule(
  v: SchedulePickerValue,
  timezone: string,
): RruleBridgeOutput {
  const tod = v.timeOfDay ?? '09:00';
  switch (v.interval) {
    case 'daily':
      return { rrule: 'FREQ=DAILY;INTERVAL=1', scheduleTime: tod, timezone };
    case 'weekly': {
      const day = DOW_TO_RRULE[v.dayOfWeek ?? 1] ?? 'MO';
      return { rrule: `FREQ=WEEKLY;INTERVAL=1;BYDAY=${day}`, scheduleTime: tod, timezone };
    }
    case 'monthly': {
      const d = v.dayOfMonth ?? 1;
      return {
        rrule: `FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${d > 28 ? 28 : d}`,
        scheduleTime: tod,
        timezone,
      };
    }
    case 'quarterly':
      return { rrule: 'FREQ=MONTHLY;INTERVAL=3', scheduleTime: tod, timezone };
    case 'half_yearly':
      return { rrule: 'FREQ=MONTHLY;INTERVAL=6', scheduleTime: tod, timezone };
    case 'annually':
      return { rrule: 'FREQ=YEARLY;INTERVAL=1', scheduleTime: tod, timezone };
  }
}

export default SchedulePicker;
