// ---------------------------------------------------------------------------
// ScheduleCalendar — forward projection grid renderer
// ---------------------------------------------------------------------------
//
// Feature 1 (docs/routines-response-dev-spec.md §3.4). Renders projected
// occurrences for the requested window. Ships with list + week views in v1;
// month/day views noted as out-of-scope follow-ons in the spec.
//
// This component is presentational — it does not fetch. Callers pass
// `occurrences`, `windowStart`, `windowEnd`, `truncated`, `loading`, and
// optional `onOccurrenceClick` for deep-link navigation.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { formatMoney } from '../lib/formatMoney';

export type OccurrenceSource = 'heartbeat' | 'cron' | 'workflow' | 'scheduled_task';
export type ScopeTag = 'system' | 'org' | 'subaccount';

export interface ScheduleOccurrence {
  occurrenceId: string;
  scheduledAt: string;
  source: OccurrenceSource;
  sourceId: string;
  sourceName: string;
  subaccountId: string;
  subaccountName: string;
  agentId?: string;
  agentName?: string;
  runType: 'scheduled';
  estimatedTokens: number | null;
  estimatedCost: number | null;
  scopeTag: ScopeTag;
}

export interface ScheduleCalendarResponse {
  windowStart: string;
  windowEnd: string;
  occurrences: ScheduleOccurrence[];
  truncated: boolean;
  totalsAreTruncated: boolean;
  estimatedTotalCount: number | null;
  totals: { count: number; estimatedTokens: number; estimatedCost: number };
}

export interface ScheduleCalendarProps {
  data: ScheduleCalendarResponse | null;
  loading: boolean;
  error?: string | null;
  onOccurrenceClick?: (occ: ScheduleOccurrence) => void;
  showCost?: boolean;
  /** When true, show the Subaccount column (org-wide view). */
  showSubaccountColumn?: boolean;
}

const SOURCE_LABELS: Record<OccurrenceSource, string> = {
  heartbeat: 'Heartbeat',
  cron: 'Cron',
  playbook: 'Workflow',
  scheduled_task: 'Scheduled task',
};

const SOURCE_BADGE_STYLES: Record<OccurrenceSource, string> = {
  heartbeat: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cron: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  playbook: 'bg-amber-50 text-amber-700 border-amber-200',
  scheduled_task: 'bg-sky-50 text-sky-700 border-sky-200',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function groupByDay(occs: ScheduleOccurrence[]): Array<{ dayKey: string; label: string; items: ScheduleOccurrence[] }> {
  const byDay = new Map<string, ScheduleOccurrence[]>();
  for (const o of occs) {
    const d = new Date(o.scheduledAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(o);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, items]) => {
      const [y, m, d] = dayKey.split('-').map(Number);
      const dayDate = new Date(y, m - 1, d);
      return {
        dayKey,
        label: dayDate.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        }),
        items,
      };
    });
}

type FilterState = {
  source: Set<OccurrenceSource>;
  scopeTag: Set<ScopeTag>;
  subaccountId: Set<string>;
};

const EMPTY_FILTER: FilterState = { source: new Set(), scopeTag: new Set(), subaccountId: new Set() };

export default function ScheduleCalendar({
  data,
  loading,
  error,
  onOccurrenceClick,
  showCost = true,
  showSubaccountColumn = false,
}: ScheduleCalendarProps) {
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);

  const allOccurrences = data?.occurrences ?? [];

  const filteredOccurrences = useMemo(() => {
    const { source, scopeTag, subaccountId } = filter;
    return allOccurrences.filter((o) => {
      if (source.size > 0 && !source.has(o.source)) return false;
      if (scopeTag.size > 0 && !scopeTag.has(o.scopeTag)) return false;
      if (subaccountId.size > 0 && !subaccountId.has(o.subaccountId)) return false;
      return true;
    });
  }, [allOccurrences, filter]);

  const grouped = useMemo(() => groupByDay(filteredOccurrences), [filteredOccurrences]);

  const subaccountOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of allOccurrences) map.set(o.subaccountId, o.subaccountName);
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [allOccurrences]);

  const toggleFilter = <K extends keyof FilterState>(key: K, value: FilterState[K] extends Set<infer V> ? V : never) => {
    setFilter((prev) => {
      const next = { ...prev, [key]: new Set(prev[key]) } as FilterState;
      const set = next[key] as Set<unknown>;
      if (set.has(value)) set.delete(value);
      else set.add(value);
      return next;
    });
  };

  const anyFilter =
    filter.source.size > 0 || filter.scopeTag.size > 0 || filter.subaccountId.size > 0;

  // Recompute tokens + cost from the filtered set so the totals strip always
  // reflects what's visible — not the full unfiltered server response.
  const filteredTotals = useMemo(() => {
    let estimatedTokens = 0;
    let estimatedCost = 0;
    for (const o of filteredOccurrences) {
      estimatedTokens += o.estimatedTokens ?? 0;
      estimatedCost += o.estimatedCost ?? 0;
    }
    return { estimatedTokens, estimatedCost };
  }, [filteredOccurrences]);

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Loading calendar…</div>;
  }
  if (error) {
    return <div className="p-6 text-sm text-rose-600">Error: {error}</div>;
  }
  if (!data) {
    return <div className="p-6 text-sm text-slate-500">No data.</div>;
  }

  return (
    <div className="space-y-4">
      {/* Truncation banner */}
      {data.truncated && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Showing {data.occurrences.length.toLocaleString()} of{' '}
            {data.estimatedTotalCount !== null
              ? `~${data.estimatedTotalCount.toLocaleString()}`
              : 'many more'}
          </strong>
          {' '}projected occurrences. Narrow the window or apply a subaccount filter to see all upcoming runs.
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-slate-500">Source:</span>
        {(Object.keys(SOURCE_LABELS) as OccurrenceSource[]).map((src) => {
          const active = filter.source.has(src);
          return (
            <button
              key={src}
              type="button"
              onClick={() => toggleFilter('source', src)}
              className={`rounded-full border px-2.5 py-1 ${
                active
                  ? SOURCE_BADGE_STYLES[src] + ' ring-2 ring-offset-1 ring-slate-300'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              {SOURCE_LABELS[src]}
            </button>
          );
        })}

        {showSubaccountColumn && subaccountOptions.length > 1 && (
          <>
            <span className="ml-2 font-medium text-slate-500">Subaccount:</span>
            <select
              className="rounded border border-slate-200 bg-white px-2 py-1"
              value=""
              onChange={(e) => {
                if (e.target.value) toggleFilter('subaccountId', e.target.value);
              }}
            >
              <option value="">+ Add filter</option>
              {subaccountOptions
                .filter((s) => !filter.subaccountId.has(s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
            {Array.from(filter.subaccountId).map((id) => {
              const name = subaccountOptions.find((s) => s.id === id)?.name ?? id;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2 py-1"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => toggleFilter('subaccountId', id)}
                    className="text-slate-500 hover:text-slate-900"
                    aria-label="Remove filter"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </>
        )}

        {anyFilter && (
          <button
            type="button"
            onClick={() => setFilter(EMPTY_FILTER)}
            className="ml-auto text-xs text-indigo-600 hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Totals strip */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <div className="flex flex-wrap gap-6">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Occurrences</div>
            <div className="text-xl font-semibold text-slate-900">{filteredOccurrences.length.toLocaleString()}</div>
          </div>
          {showCost && (
            <>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Est. tokens</div>
                <div className="text-xl font-semibold text-slate-900">
                  {Math.round(filteredTotals.estimatedTokens).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Est. cost</div>
                <div className="text-xl font-semibold text-slate-900">
                  {formatMoney(filteredTotals.estimatedCost)}
                </div>
              </div>
            </>
          )}
          {data.totalsAreTruncated && !anyFilter && (
            <div className="self-center text-xs text-amber-700">
              Totals reflect only the first {data.occurrences.length.toLocaleString()} occurrences.
            </div>
          )}
        </div>
      </div>

      {/* List view */}
      {grouped.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">
          No scheduled occurrences in this window.
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map((day) => (
            <div key={day.dayKey} className="rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-[12px] font-semibold text-slate-700">
                {day.label} · {day.items.length} run{day.items.length === 1 ? '' : 's'}
              </div>
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-slate-500">
                  <tr className="border-b border-slate-100">
                    <th className="px-4 py-2 text-left">Time</th>
                    <th className="px-4 py-2 text-left">Source</th>
                    <th className="px-4 py-2 text-left">Name</th>
                    {showSubaccountColumn && <th className="px-4 py-2 text-left">Subaccount</th>}
                    <th className="px-4 py-2 text-left">Agent</th>
                    {showCost && <th className="px-4 py-2 text-right">Est. tokens</th>}
                    {showCost && <th className="px-4 py-2 text-right">Est. cost</th>}
                  </tr>
                </thead>
                <tbody>
                  {day.items.map((occ) => (
                    <tr
                      key={occ.occurrenceId}
                      className={`border-b border-slate-100 last:border-b-0 ${
                        onOccurrenceClick ? 'cursor-pointer hover:bg-slate-50' : ''
                      }`}
                      onClick={() => onOccurrenceClick?.(occ)}
                    >
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">
                        {new Date(occ.scheduledAt).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${SOURCE_BADGE_STYLES[occ.source]}`}
                        >
                          {SOURCE_LABELS[occ.source]}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-800">{occ.sourceName}</td>
                      {showSubaccountColumn && (
                        <td className="px-4 py-2 text-slate-600">{occ.subaccountName}</td>
                      )}
                      <td className="px-4 py-2 text-slate-600">{occ.agentName ?? '—'}</td>
                      {showCost && (
                        <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
                          {occ.estimatedTokens === null
                            ? '—'
                            : Math.round(occ.estimatedTokens).toLocaleString()}
                        </td>
                      )}
                      {showCost && (
                        <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
                          {formatMoney(occ.estimatedCost, { micro: true })}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <div className="text-[11px] text-slate-400">
        Window: {formatDateTime(data.windowStart)} — {formatDateTime(data.windowEnd)}
      </div>
    </div>
  );
}
