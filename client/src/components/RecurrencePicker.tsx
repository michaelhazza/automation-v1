import React, { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// RecurrencePicker — Google Calendar-style custom recurrence builder
// Outputs an RRULE string + optional end conditions (endsAt, endsAfterRuns)
// ---------------------------------------------------------------------------

export interface RecurrenceValue {
  rrule: string;
  endsAt?: string | null;       // ISO date string
  endsAfterRuns?: number | null;
}

interface Props {
  value: RecurrenceValue;
  onChange: (value: RecurrenceValue) => void;
}

type FreqUnit = 'day' | 'week' | 'month' | 'year';
type EndType = 'never' | 'on' | 'after';

const DAYS = [
  { key: 'MO', label: 'M' },
  { key: 'TU', label: 'T' },
  { key: 'WE', label: 'W' },
  { key: 'TH', label: 'T' },
  { key: 'FR', label: 'F' },
  { key: 'SA', label: 'S' },
  { key: 'SU', label: 'S' },
];

const FREQ_MAP: Record<FreqUnit, string> = {
  day: 'DAILY',
  week: 'WEEKLY',
  month: 'MONTHLY',
  year: 'YEARLY',
};

// Parse an RRULE string into component parts
function parseRRule(rrule: string): {
  freq: FreqUnit;
  interval: number;
  byDay: string[];
  byMonthDay: number | null;
} {
  const parts: Record<string, string> = {};
  rrule.split(';').forEach(p => {
    const [k, v] = p.split('=');
    if (k && v) parts[k] = v;
  });

  let freq: FreqUnit = 'week';
  if (parts.FREQ === 'DAILY') freq = 'day';
  else if (parts.FREQ === 'WEEKLY') freq = 'week';
  else if (parts.FREQ === 'MONTHLY') freq = 'month';
  else if (parts.FREQ === 'YEARLY') freq = 'year';

  const interval = parts.INTERVAL ? parseInt(parts.INTERVAL, 10) : 1;
  const byDay = parts.BYDAY ? parts.BYDAY.split(',') : [];
  const byMonthDay = parts.BYMONTHDAY ? parseInt(parts.BYMONTHDAY, 10) : null;

  return { freq, interval, byDay, byMonthDay };
}

// Build an RRULE string from component parts
function buildRRule(freq: FreqUnit, interval: number, byDay: string[], byMonthDay: number | null): string {
  const parts = [`FREQ=${FREQ_MAP[freq]}`, `INTERVAL=${interval}`];
  if (freq === 'week' && byDay.length > 0) {
    parts.push(`BYDAY=${byDay.join(',')}`);
  }
  if (freq === 'month' && byMonthDay !== null) {
    parts.push(`BYMONTHDAY=${byMonthDay}`);
  }
  return parts.join(';');
}

function defaultEndDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return d.toISOString().split('T')[0];
}

export default function RecurrencePicker({ value, onChange }: Props) {
  // Custom recurrence state
  const parsed = parseRRule(value.rrule || 'FREQ=WEEKLY;INTERVAL=1');
  const [freq, setFreq] = useState<FreqUnit>(parsed.freq);
  const [interval, setInterval] = useState(parsed.interval);
  const [byDay, setByDay] = useState<string[]>(parsed.byDay);
  const [byMonthDay, setByMonthDay] = useState<number | null>(parsed.byMonthDay ?? new Date().getDate());

  // End conditions
  const [endType, setEndType] = useState<EndType>(
    value.endsAt ? 'on' : value.endsAfterRuns ? 'after' : 'never'
  );
  const [endDate, setEndDate] = useState(value.endsAt || defaultEndDate());
  const [endAfter, setEndAfter] = useState(value.endsAfterRuns || 13);

  // Sync parsed values when value.rrule changes externally
  useEffect(() => {
    const p = parseRRule(value.rrule || 'FREQ=WEEKLY;INTERVAL=1');
    setFreq(p.freq);
    setInterval(p.interval);
    setByDay(p.byDay);
    if (p.byMonthDay !== null) setByMonthDay(p.byMonthDay);
  }, [value.rrule]);

  function emitCustom(
    f: FreqUnit = freq,
    i: number = interval,
    bd: string[] = byDay,
    bmd: number | null = byMonthDay,
    et: EndType = endType,
    ed: string = endDate,
    ea: number = endAfter,
  ) {
    const rrule = buildRRule(f, i, bd, bmd);
    onChange({
      rrule,
      endsAt: et === 'on' ? ed : null,
      endsAfterRuns: et === 'after' ? ea : null,
    });
  }

  function handleFreqChange(newFreq: FreqUnit) {
    setFreq(newFreq);
    // Reset day-specific fields when frequency changes
    if (newFreq !== 'week') setByDay([]);
    if (newFreq === 'month' && byMonthDay === null) setByMonthDay(new Date().getDate());
    emitCustom(newFreq, interval, newFreq === 'week' ? byDay : [], newFreq === 'month' ? (byMonthDay ?? new Date().getDate()) : null);
  }

  function handleIntervalChange(newInterval: number) {
    const clamped = Math.max(1, Math.min(99, newInterval));
    setInterval(clamped);
    emitCustom(freq, clamped);
  }

  function toggleDay(day: string) {
    const next = byDay.includes(day) ? byDay.filter(d => d !== day) : [...byDay, day];
    setByDay(next);
    emitCustom(freq, interval, next);
  }

  function handleMonthDayChange(day: number) {
    const clamped = Math.max(1, Math.min(31, day));
    setByMonthDay(clamped);
    emitCustom(freq, interval, byDay, clamped);
  }

  function handleEndTypeChange(newEnd: EndType) {
    setEndType(newEnd);
    emitCustom(freq, interval, byDay, byMonthDay, newEnd, endDate, endAfter);
  }

  function handleEndDateChange(newDate: string) {
    setEndDate(newDate);
    emitCustom(freq, interval, byDay, byMonthDay, 'on', newDate, endAfter);
  }

  function handleEndAfterChange(newCount: number) {
    const clamped = Math.max(1, Math.min(999, newCount));
    setEndAfter(clamped);
    emitCustom(freq, interval, byDay, byMonthDay, 'after', endDate, clamped);
  }

  return (
    <div>
      {/* Recurrence panel */}
      <div className="bg-[#fafbfc] border border-slate-200 rounded-[10px] p-5">
        {/* Repeat every N unit */}
        <div className="mb-5">
          <div className="text-sm font-medium text-gray-700 mb-2.5">Repeat every</div>
          <div className="flex items-center gap-2.5">
            <input
              type="number"
              min={1}
              max={99}
              value={interval}
              onChange={e => handleIntervalChange(parseInt(e.target.value, 10) || 1)}
              className="w-16 px-2.5 py-2 border border-gray-300 rounded-lg text-sm text-center font-[inherit] bg-white"
            />
            <select
              value={freq}
              onChange={e => handleFreqChange(e.target.value as FreqUnit)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-[inherit] bg-white cursor-pointer"
            >
              <option value="day">day{interval > 1 ? 's' : ''}</option>
              <option value="week">week{interval > 1 ? 's' : ''}</option>
              <option value="month">month{interval > 1 ? 's' : ''}</option>
              <option value="year">year{interval > 1 ? 's' : ''}</option>
            </select>
          </div>
        </div>

        {/* Repeat on — weekday selector (weekly only) */}
        {freq === 'week' && (
          <div className="mb-5">
            <div className="text-sm font-medium text-gray-700 mb-2.5">Repeat on</div>
            <div className="flex gap-1.5">
              {DAYS.map((d, i) => {
                const active = byDay.includes(d.key);
                return (
                  <button
                    key={d.key + i}
                    type="button"
                    onClick={() => toggleDay(d.key)}
                    className={`w-9 h-9 rounded-full border-0 text-[13px] font-semibold cursor-pointer font-[inherit] transition-[background,color] duration-150 ${
                      active ? 'bg-indigo-500 text-white' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Month day selector (monthly only) */}
        {freq === 'month' && (
          <div className="mb-5">
            <div className="text-sm font-medium text-gray-700 mb-2.5">Repeat on</div>
            <select
              value={`day_${byMonthDay}`}
              onChange={e => {
                const val = e.target.value;
                handleMonthDayChange(parseInt(val.replace('day_', ''), 10));
              }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-[inherit] bg-white cursor-pointer"
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                <option key={d} value={`day_${d}`}>Monthly on day {d}</option>
              ))}
            </select>
          </div>
        )}

        {/* Ends */}
        <div>
          <div className="text-sm font-medium text-gray-700 mb-2.5">Ends</div>
          <div className="flex flex-col gap-2.5">
            {/* Never */}
            <label className="flex items-center gap-2.5 cursor-pointer text-sm text-slate-800">
              <input
                type="radio"
                name="endType"
                checked={endType === 'never'}
                onChange={() => handleEndTypeChange('never')}
                className="w-[18px] h-[18px] accent-indigo-500"
              />
              Never
            </label>

            {/* On date */}
            <label className="flex items-center gap-2.5 cursor-pointer text-sm text-slate-800">
              <input
                type="radio"
                name="endType"
                checked={endType === 'on'}
                onChange={() => handleEndTypeChange('on')}
                className="w-[18px] h-[18px] accent-indigo-500"
              />
              On
              <input
                type="date"
                value={endDate}
                onChange={e => handleEndDateChange(e.target.value)}
                disabled={endType !== 'on'}
                className={`px-2.5 py-1.5 border border-gray-300 rounded-lg text-[13px] font-[inherit] ${
                  endType === 'on' ? 'bg-white text-slate-800' : 'bg-slate-100 text-slate-400'
                }`}
              />
            </label>

            {/* After N occurrences */}
            <label className="flex items-center gap-2.5 cursor-pointer text-sm text-slate-800">
              <input
                type="radio"
                name="endType"
                checked={endType === 'after'}
                onChange={() => handleEndTypeChange('after')}
                className="w-[18px] h-[18px] accent-indigo-500"
              />
              After
              <input
                type="number"
                min={1}
                max={999}
                value={endAfter}
                onChange={e => handleEndAfterChange(parseInt(e.target.value, 10) || 1)}
                disabled={endType !== 'after'}
                className={`w-16 px-2.5 py-1.5 border border-gray-300 rounded-lg text-[13px] text-center font-[inherit] ${
                  endType === 'after' ? 'bg-white text-slate-800' : 'bg-slate-100 text-slate-400'
                }`}
              />
              <span className={`text-sm ${endType === 'after' ? 'text-slate-600' : 'text-slate-400'}`}>occurrences</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
