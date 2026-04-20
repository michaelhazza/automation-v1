import { useEffect, useState, useCallback } from 'react';
import api from '../lib/api';
import type {
  PnlSummary,
  OrgRow,
  OverheadRow,
  SubacctRow,
  SourceTypeRow,
  ProviderModelRow,
  DailyTrendRow,
  TopCallRow,
  PnlResponse,
} from '../../../shared/types/systemPnl';
import PnlKpiCard from '../components/system-pnl/PnlKpiCard';
import PnlGroupingTabs, { type PnlGrouping } from '../components/system-pnl/PnlGroupingTabs';
import PnlByOrganisationTable from '../components/system-pnl/PnlByOrganisationTable';
import PnlBySubaccountTable from '../components/system-pnl/PnlBySubaccountTable';
import PnlBySourceTypeTable from '../components/system-pnl/PnlBySourceTypeTable';
import PnlByProviderModelTable from '../components/system-pnl/PnlByProviderModelTable';
import PnlTrendChart from '../components/system-pnl/PnlTrendChart';
import PnlTopCallsList from '../components/system-pnl/PnlTopCallsList';
import PnlCallDetailDrawer from '../components/system-pnl/PnlCallDetailDrawer';

// System P&L admin page (spec §11).
// Cross-organisation financial dashboard, system-admin only.
// Route: /system/llm-pnl (registered in App.tsx).

const AUTO_REFRESH_MS = 60_000;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function SystemPnlPage() {
  const [month, setMonth] = useState<string>(currentMonth());
  const [grouping, setGrouping] = useState<PnlGrouping>('organisation');
  const [topCallsLimit, setTopCallsLimit] = useState<number>(10);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const [summary, setSummary]     = useState<PnlSummary | null>(null);
  const [orgs, setOrgs]           = useState<OrgRow[]>([]);
  const [orgOverhead, setOrgOverhead] = useState<OverheadRow | null>(null);
  const [subs, setSubs]           = useState<SubacctRow[]>([]);
  const [sources, setSources]     = useState<SourceTypeRow[]>([]);
  const [models, setModels]       = useState<ProviderModelRow[]>([]);
  const [trend, setTrend]         = useState<DailyTrendRow[]>([]);
  const [topCalls, setTopCalls]   = useState<TopCallRow[]>([]);
  const [loading, setLoading]     = useState<boolean>(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, o, sb, st, pm, tr, tc] = await Promise.all([
        api.get<PnlResponse<PnlSummary>>(`/api/admin/llm-pnl/summary?month=${month}`),
        api.get<PnlResponse<{ orgs: OrgRow[]; overhead: OverheadRow }>>(`/api/admin/llm-pnl/by-organisation?month=${month}`),
        api.get<PnlResponse<SubacctRow[]>>(`/api/admin/llm-pnl/by-subaccount?month=${month}`),
        api.get<PnlResponse<SourceTypeRow[]>>(`/api/admin/llm-pnl/by-source-type?month=${month}`),
        api.get<PnlResponse<ProviderModelRow[]>>(`/api/admin/llm-pnl/by-provider-model?month=${month}`),
        api.get<PnlResponse<DailyTrendRow[]>>(`/api/admin/llm-pnl/trend?days=30`),
        api.get<PnlResponse<TopCallRow[]>>(`/api/admin/llm-pnl/top-calls?month=${month}&limit=${topCallsLimit}`),
      ]);
      setSummary(s.data.data);
      setOrgs(o.data.data.orgs);
      setOrgOverhead(o.data.data.overhead);
      setSubs(sb.data.data);
      setSources(st.data.data);
      setModels(pm.data.data);
      setTrend(tr.data.data);
      setTopCalls(tc.data.data);
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }, [month, topCallsLimit]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh every 60 seconds. Matches mockup footer copy.
  useEffect(() => {
    const id = setInterval(fetchAll, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  const handleExportCsv = () => {
    const rowsForTab = groupingCsv(grouping, { orgs, subs, sources, models });
    if (rowsForTab.length === 0) return;
    const csv = toCsv(rowsForTab);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `system-pnl-${grouping}-${month}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleViewAllTopCalls = () => {
    setTopCallsLimit(50);
    document.getElementById('top-calls-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-6 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">System P&amp;L</h1>
            <p className="text-sm text-slate-500 mt-1">
              Cross-organisation revenue, cost, and platform overhead across every LLM call.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="text-sm border border-slate-300 rounded px-2 py-1"
            />
            <button
              onClick={fetchAll}
              disabled={loading}
              className="text-sm px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50"
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              onClick={handleExportCsv}
              className="text-sm px-3 py-1.5 bg-slate-900 text-white rounded hover:bg-slate-800"
            >
              Export CSV
            </button>
          </div>
        </div>

        {/* KPI cards */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <PnlKpiCard
              label="Revenue"
              valueCents={summary.revenue.cents}
              change={summary.revenue.change ? { amount: summary.revenue.change.pct, unit: 'pct', direction: summary.revenue.change.direction } : null}
            />
            <PnlKpiCard
              label="Gross profit"
              valueCents={summary.grossProfit.cents}
              sublineLeft={`Gross margin ${summary.grossProfit.margin.toFixed(1)}%`}
              change={summary.grossProfit.change ? { amount: summary.grossProfit.change.pct, unit: 'pct', direction: summary.grossProfit.change.direction } : null}
            />
            <PnlKpiCard
              label="Platform overhead"
              valueCents={summary.platformOverhead.cents}
              sublineLeft={`${summary.platformOverhead.pctOfRevenue.toFixed(1)}% of revenue`}
              tone="overhead"
            />
            <PnlKpiCard
              label="Net profit"
              valueCents={summary.netProfit.cents}
              sublineLeft={`Net margin ${summary.netProfit.margin.toFixed(1)}%`}
              change={summary.netProfit.change ? { amount: summary.netProfit.change.pp, unit: 'pp', direction: summary.netProfit.change.direction } : null}
            />
          </div>
        )}

        {/* Grouping tabs */}
        <div className="mb-4 flex items-center justify-between">
          <PnlGroupingTabs active={grouping} onChange={setGrouping} />
          <div className="text-xs text-slate-500">
            Updated {lastRefresh.toLocaleTimeString()}
          </div>
        </div>

        {/* Active table */}
        <div className="mb-6">
          {grouping === 'organisation'   && <PnlByOrganisationTable orgs={orgs} overhead={orgOverhead} />}
          {grouping === 'subaccount'     && <PnlBySubaccountTable rows={subs} />}
          {grouping === 'source-type'    && <PnlBySourceTypeTable rows={sources} />}
          {grouping === 'provider-model' && <PnlByProviderModelTable rows={models} />}
        </div>

        {/* Trend chart */}
        <div className="mb-6">
          <PnlTrendChart rows={trend} />
        </div>

        {/* Top calls by cost */}
        <div className="mb-6">
          <PnlTopCallsList
            rows={topCalls}
            limit={topCallsLimit}
            onClickRow={setSelectedCallId}
            onViewAll={handleViewAllTopCalls}
          />
        </div>

        {/* Footer — mockup copy. Links are decorative per spec §11.4.1. */}
        <div className="mt-10 pt-6 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between">
          <div>Platform-wide view · updated every 60 seconds</div>
          <div className="flex items-center gap-4">
            <span className="text-slate-400 cursor-default" title="Deferred">Margin policies</span>
            <span className="text-slate-400 cursor-default" title="Deferred">Retention</span>
            <span className="text-slate-400 cursor-default" title="Deferred">Billing rules</span>
          </div>
        </div>
      </div>

      <PnlCallDetailDrawer
        callId={selectedCallId}
        onClose={() => setSelectedCallId(null)}
      />
    </div>
  );
}

// ── CSV export helpers ─────────────────────────────────────────────────────

function groupingCsv(
  tab: PnlGrouping,
  data: { orgs: OrgRow[]; subs: SubacctRow[]; sources: SourceTypeRow[]; models: ProviderModelRow[] },
): Array<Record<string, unknown>> {
  switch (tab) {
    case 'organisation':   return data.orgs.map(stripSparkline) as unknown as Array<Record<string, unknown>>;
    case 'subaccount':     return data.subs as unknown as Array<Record<string, unknown>>;
    case 'source-type':    return data.sources as unknown as Array<Record<string, unknown>>;
    case 'provider-model': return data.models as unknown as Array<Record<string, unknown>>;
  }
}

function stripSparkline(o: OrgRow): Omit<OrgRow, 'trendSparkline'> {
  const { trendSparkline: _ignore, ...rest } = o;
  return rest;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => escape(r[h])).join(','));
  return lines.join('\n');
}
