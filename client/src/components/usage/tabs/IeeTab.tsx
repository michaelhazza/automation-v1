import { formatCents } from '../format';
import { SummaryCard } from '../atoms/SummaryCard';
import type { IeeUsageRow, IeeUsageSummary, IeeFilters } from '../types';

interface IeeTabProps {
  rows: IeeUsageRow[];
  summary: IeeUsageSummary | null;
  loading: boolean;
  filters: IeeFilters;
  onFilterChange: (next: IeeFilters) => void;
}

export function IeeTab({ rows, summary, loading, filters, onFilterChange }: IeeTabProps) {
  const setF = (k: keyof IeeFilters, v: string) => onFilterChange({ ...filters, [k]: v });
  return (
    <div>
      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Type</label>
            <select
              value={filters.types}
              onChange={e => setF('types', e.target.value)}
              className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 [font-family:inherit]"
            >
              <option value="">All</option>
              <option value="browser">Browser</option>
              <option value="dev">Dev</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Status</label>
            <select
              value={filters.statuses}
              onChange={e => setF('statuses', e.target.value)}
              className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 [font-family:inherit]"
            >
              <option value="">All</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="running">Running</option>
              <option value="pending">Pending</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Min cost (cents)</label>
            <input
              type="number"
              value={filters.minCostCents}
              onChange={e => setF('minCostCents', e.target.value)}
              className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 [font-family:inherit]"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Goal contains</label>
            <input
              type="text"
              value={filters.search}
              onChange={e => setF('search', e.target.value)}
              className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 [font-family:inherit]"
              placeholder="search…"
            />
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <SummaryCard label="Total" value={formatCents(summary?.total.cents ?? 0)} sub={`${summary?.total.runCount ?? 0} runs`} />
        <SummaryCard label="LLM"     value={formatCents(summary?.llm.cents ?? 0)}     sub={`${summary?.llm.callCount ?? 0} calls`} />
        <SummaryCard label="Compute" value={formatCents(summary?.compute.cents ?? 0)} sub="worker time" />
        <SummaryCard label="Avg / run" value={formatCents(summary && summary.total.runCount > 0 ? Math.round(summary.total.cents / summary.total.runCount) : 0)} sub="" />
      </div>

      {/* Runs table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-3 py-2 font-semibold text-[11px] text-slate-600 uppercase tracking-wider">Started</th>
              <th className="text-left px-3 py-2 font-semibold text-[11px] text-slate-600 uppercase tracking-wider">Type</th>
              <th className="text-left px-3 py-2 font-semibold text-[11px] text-slate-600 uppercase tracking-wider">Status</th>
              <th className="text-right px-3 py-2 font-semibold text-[11px] text-slate-600 uppercase tracking-wider">Steps</th>
              <th className="text-right px-3 py-2 font-semibold text-[11px] text-slate-600 uppercase tracking-wider">LLM</th>
              <th className="text-right px-3 py-2 font-semibold text-[11px] text-slate-600 uppercase tracking-wider">Compute</th>
              <th className="text-right px-3 py-2 font-semibold text-[11px] text-slate-600 uppercase tracking-wider">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No IEE runs in this period.</td></tr>
            ) : (
              rows.map(r => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">{r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[11px] font-semibold uppercase">{r.type}</span></td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                      r.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                      r.status === 'failed'    ? 'bg-rose-50 text-rose-700' :
                      r.status === 'running'   ? 'bg-amber-50 text-amber-700' :
                                                 'bg-slate-100 text-slate-600'
                    }`}>{r.status}</span>
                    {r.failureReason ? <span className="ml-2 text-[11px] text-slate-500">{r.failureReason}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.stepCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(r.llmCostCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(r.runtimeCostCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCents(r.totalCostCents)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
