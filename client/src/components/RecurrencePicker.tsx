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

  const unitLabel = interval === 1 ? freq : `${freq}s`;

  return (
    <div>
      {/* Recurrence panel */}
      <div style={{
        background: '#fafbfc', border: '1px solid #e2e8f0', borderRadius: 10,
        padding: 20,
      }}>
          {/* Repeat every N unit */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 10 }}>Repeat every</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="number"
                min={1}
                max={99}
                value={interval}
                onChange={e => handleIntervalChange(parseInt(e.target.value, 10) || 1)}
                style={{
                  width: 64, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8,
                  fontSize: 14, textAlign: 'center', fontFamily: 'inherit', background: '#fff',
                }}
              />
              <select
                value={freq}
                onChange={e => handleFreqChange(e.target.value as FreqUnit)}
                style={{
                  padding: '8px 28px 8px 12px', border: '1px solid #d1d5db', borderRadius: 8,
                  fontSize: 14, fontFamily: 'inherit', background: '#fff', cursor: 'pointer',
                  appearance: 'auto',
                }}
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
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 10 }}>Repeat on</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {DAYS.map((d, i) => {
                  const active = byDay.includes(d.key);
                  return (
                    <button
                      key={d.key + i}
                      type="button"
                      onClick={() => toggleDay(d.key)}
                      style={{
                        width: 36, height: 36, borderRadius: '50%', border: 'none',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        fontFamily: 'inherit',
                        background: active ? '#6366f1' : '#e2e8f0',
                        color: active ? '#fff' : '#475569',
                        transition: 'background 0.15s, color 0.15s',
                      }}
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
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 10 }}>Repeat on</div>
              <select
                value={`day_${byMonthDay}`}
                onChange={e => {
                  const val = e.target.value;
                  handleMonthDayChange(parseInt(val.replace('day_', ''), 10));
                }}
                style={{
                  padding: '8px 28px 8px 12px', border: '1px solid #d1d5db', borderRadius: 8,
                  fontSize: 14, fontFamily: 'inherit', background: '#fff', cursor: 'pointer',
                  appearance: 'auto',
                }}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={`day_${d}`}>Monthly on day {d}</option>
                ))}
              </select>
            </div>
          )}

          {/* Ends */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 10 }}>Ends</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Never */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, color: '#1e293b' }}>
                <input
                  type="radio"
                  name="endType"
                  checked={endType === 'never'}
                  onChange={() => handleEndTypeChange('never')}
                  style={{ width: 18, height: 18, accentColor: '#6366f1' }}
                />
                Never
              </label>

              {/* On date */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, color: '#1e293b' }}>
                <input
                  type="radio"
                  name="endType"
                  checked={endType === 'on'}
                  onChange={() => handleEndTypeChange('on')}
                  style={{ width: 18, height: 18, accentColor: '#6366f1' }}
                />
                On
                <input
                  type="date"
                  value={endDate}
                  onChange={e => handleEndDateChange(e.target.value)}
                  disabled={endType !== 'on'}
                  style={{
                    padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 8,
                    fontSize: 13, fontFamily: 'inherit', background: endType === 'on' ? '#fff' : '#f1f5f9',
                    color: endType === 'on' ? '#1e293b' : '#94a3b8',
                  }}
                />
              </label>

              {/* After N occurrences */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, color: '#1e293b' }}>
                <input
                  type="radio"
                  name="endType"
                  checked={endType === 'after'}
                  onChange={() => handleEndTypeChange('after')}
                  style={{ width: 18, height: 18, accentColor: '#6366f1' }}
                />
                After
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={endAfter}
                  onChange={e => handleEndAfterChange(parseInt(e.target.value, 10) || 1)}
                  disabled={endType !== 'after'}
                  style={{
                    width: 64, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 8,
                    fontSize: 13, textAlign: 'center', fontFamily: 'inherit',
                    background: endType === 'after' ? '#fff' : '#f1f5f9',
                    color: endType === 'after' ? '#1e293b' : '#94a3b8',
                  }}
                />
                <span style={{ color: endType === 'after' ? '#475569' : '#94a3b8', fontSize: 14 }}>occurrences</span>
              </label>
            </div>
          </div>

          {/* Summary */}
          <div style={{
            marginTop: 16, padding: '10px 14px', background: '#eef2ff', borderRadius: 8,
            fontSize: 12, color: '#4338ca', fontFamily: 'monospace',
          }}>
            {value.rrule}
          </div>
        </div>
    </div>
  );
}
