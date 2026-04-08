import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import { RunActivityChart } from '../components/ActivityCharts';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface UsageSummary {
  period: string;
  monthly: CostAggregate | null;
  today:   CostAggregate | null;
  limits:  WorkspaceLimits | null;
}

interface CostAggregate {
  totalCostCents: number;
  requestCount: number;
  errorCount: number;
  tokensIn?: number;
  tokensOut?: number;
}

interface WorkspaceLimits {
  monthlyCostLimitCents: number | null;
  dailyCostLimitCents: number | null;
  maxCostPerRunCents: number | null;
}

interface AgentUsageRow {
  agentName: string | null;
  requestCount: number;
  totalCostCents: number;
  totalTokensIn: number;
  totalTokensOut: number;
  errorCount: number;
}

interface ModelUsageRow {
  provider: string;
  model: string;
  requestCount: number;
  totalCostCents: number;
  totalTokensIn: number;
  totalTokensOut: number;
  avgLatencyMs: number;
}

interface RunCostRow {
  entityId: string;
  totalCostCents: number;
  requestCount: number;
  updatedAt: string;
}

interface DayBucket {
  date: string;
  completed: number;
  failed: number;
  timeout: number;
  other: number;
  total: number;
}

// ─── Routing tab types ────────────────────────────────────────────────────────

interface RoutingDistribution {
  totalRequests: number;
  totalCostCents: number;
  byTier: { frontier: number; economy: number };
  byReason: Record<string, number>;
  byPhase: Record<string, number>;
  byStatus: Record<string, number>;
  byProvider: Record<string, number>;
  costByTier: { frontier: number; economy: number };
  costByReason: Record<string, number>;
  latencyByProvider: Record<string, number>;
  latencyByTier: { frontier: number; economy: number };
  fallbackPct: number;
  escalationPct: number;
  downgradePct: number;
}

interface RoutingLogItem {
  id: string;
  createdAt: string;
  agentName: string | null;
  provider: string;
  model: string;
  requestedProvider: string | null;
  requestedModel: string | null;
  executionPhase: string;
  capabilityTier: string;
  routingReason: string | null;
  status: string;
  providerLatencyMs: number | null;
  routerOverheadMs: number | null;
  costWithMarginCents: number;
  wasDowngraded: boolean;
  wasEscalated: boolean;
  escalationReason: string | null;
  fallbackChain: string | null;
  tokensIn: number;
  tokensOut: number;
  cachedPromptTokens: number;
  costRaw: string;
  costWithMargin: string;
  marginMultiplier: string;
  requestPayloadHash: string | null;
  responsePayloadHash: string | null;
  idempotencyKey: string;
  runId: string | null;
  executionId: string | null;
  taskType: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '—';
  if (cents < 100) return `$0.${String(Math.round(cents)).padStart(2, '0')}`;
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTokens(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 1);
  const now = new Date();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return next > nowStr ? nowStr : next;
}

// ─── Chevron icons ─────────────────────────────────────────────────────────────

const ChevLeft = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const ChevRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// ─── Budget bar ────────────────────────────────────────────────────────────────

function BudgetBar({ spent, limit, label }: { spent: number; limit: number | null; label: string }) {
  if (!limit) return null;
  const pct = Math.min(spent / limit, 1);
  const isWarning = pct > 0.75;
  const isDanger = pct > 0.9;
  return (
    <div className="mt-3">
      <div className="flex justify-between text-[12px] mb-1">
        <span className="text-slate-500">{label}</span>
        <span className={`font-semibold ${isDanger ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-slate-700'}`}>
          {formatCents(spent)} / {formatCents(limit)}
          <span className="ml-1.5 text-slate-400 font-normal">({Math.round(pct * 100)}%)</span>
        </span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isDanger ? 'bg-red-400' : isWarning ? 'bg-amber-400' : 'bg-indigo-400'
          }`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}

// ─── Tab bar ───────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'agents' | 'models' | 'runs' | 'routing' | 'iee';

// ─── IEE row types — backed by /api/subaccounts/:id/iee/usage etc. ────────────
interface IeeUsageRow {
  id: string;
  agentId: string;
  type: 'browser' | 'dev';
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  stepCount: number;
  llmCostCents: number;
  runtimeCostCents: number;
  totalCostCents: number;
  failureReason: string | null;
}

interface IeeUsageSummary {
  total:   { cents: number; runCount: number };
  llm:     { cents: number; callCount: number };
  compute: { cents: number };
}

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'agents',   label: 'Agents' },
    { id: 'models',   label: 'Models' },
    { id: 'runs',     label: 'Runs' },
    { id: 'routing',  label: 'Routing' },
    { id: 'iee',      label: 'IEE Execution' },
  ];
  return (
    <div className="flex gap-0.5 border-b border-slate-200 mb-6">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-4 py-2.5 text-[13px] font-semibold border-0 bg-transparent cursor-pointer transition-colors border-b-2 -mb-px [font-family:inherit] ${
            active === t.id
              ? 'text-indigo-600 border-indigo-500'
              : 'text-slate-500 border-transparent hover:text-slate-800'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function UsagePage({ user: _user, embedded = false }: { user: User; embedded?: boolean }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();

  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [tab, setTab] = useState<Tab>('overview');

  const [summary, setSummary]     = useState<UsageSummary | null>(null);
  const [agents, setAgents]       = useState<AgentUsageRow[]>([]);
  const [models, setModels]       = useState<ModelUsageRow[]>([]);
  const [runs, setRuns]           = useState<RunCostRow[]>([]);
  const [daily, setDaily]         = useState<DayBucket[]>([]);
  const [loading, setLoading]     = useState(true);
  const [tabLoading, setTabLoading] = useState(false);

  // Routing tab state
  const [routingDist, setRoutingDist]         = useState<RoutingDistribution | null>(null);
  const [routingLog, setRoutingLog]           = useState<RoutingLogItem[]>([]);
  const [routingNextCursor, setRoutingNextCursor]   = useState<string | null>(null);
  const [routingNextCursorId, setRoutingNextCursorId] = useState<string | null>(null);
  const [routingLoadingMore, setRoutingLoadingMore] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<RoutingLogItem | null>(null);
  const [routingFilters, setRoutingFilters]   = useState<Record<string, string>>({});

  // ── IEE tab state (rev 6 §11.8) ──────────────────────────────────────────
  const [ieeRows,    setIeeRows]    = useState<IeeUsageRow[]>([]);
  const [ieeSummary, setIeeSummary] = useState<IeeUsageSummary | null>(null);
  const [ieeFilters, setIeeFilters] = useState<{
    types: string;          // 'browser,dev'
    statuses: string;       // 'completed,failed,...'
    minCostCents: string;
    search: string;
  }>({ types: '', statuses: '', minCostCents: '', search: '' });

  // Load summary + daily activity on month change
  useEffect(() => {
    if (!subaccountId) return;
    setLoading(true);
    Promise.all([
      api.get(`/api/subaccounts/${subaccountId}/usage/summary`, { params: { month } }),
      api.get('/api/agent-activity/daily', { params: { subaccountId, sinceDays: 14 } }),
    ]).then(([s, d]) => {
      setSummary(s.data);
      setDaily(d.data);
    }).catch((err) => console.error('[UsagePage] Failed to load usage data:', err)).finally(() => setLoading(false));
  }, [subaccountId, month]);

  // Load tab data on tab change
  const loadTab = useCallback(async (t: Tab) => {
    if (!subaccountId) return;
    setTabLoading(true);
    try {
      if (t === 'agents') {
        const { data } = await api.get(`/api/subaccounts/${subaccountId}/usage/agents`, { params: { month } });
        setAgents(data.agents ?? []);
      } else if (t === 'models') {
        const { data } = await api.get(`/api/subaccounts/${subaccountId}/usage/models`, { params: { month } });
        setModels(data.models ?? []);
      } else if (t === 'runs') {
        const { data } = await api.get(`/api/subaccounts/${subaccountId}/usage/runs`);
        setRuns(data.runs ?? []);
      } else if (t === 'routing') {
        const params: Record<string, string> = { month, ...routingFilters };
        const [distRes, logRes] = await Promise.all([
          api.get(`/api/subaccounts/${subaccountId}/usage/routing-distribution`, { params: { month } }),
          api.get(`/api/subaccounts/${subaccountId}/usage/routing-log`, { params }),
        ]);
        setRoutingDist(distRes.data);
        setRoutingLog(logRes.data.items ?? []);
        setRoutingNextCursor(logRes.data.nextCursor);
        setRoutingNextCursorId(logRes.data.nextCursorId);
        setSelectedRequest(null);
      } else if (t === 'iee') {
        // §11.8.6 — single-endpoint cursor-paginated query.
        // Date range = the active month so the IEE tab inherits the page-level
        // month picker. The user can refine via the IEE-specific filters.
        const monthStart = new Date(`${month}-01T00:00:00Z`).toISOString();
        const monthEndDate = new Date(`${month}-01T00:00:00Z`);
        monthEndDate.setUTCMonth(monthEndDate.getUTCMonth() + 1);
        const monthEnd = monthEndDate.toISOString();
        const params: Record<string, string> = {
          from: monthStart,
          to:   monthEnd,
          sort: 'startedAt',
          order: 'desc',
          limit: '50',
        };
        if (ieeFilters.types)        params.types        = ieeFilters.types;
        if (ieeFilters.statuses)     params.statuses     = ieeFilters.statuses;
        if (ieeFilters.minCostCents) params.minCostCents = ieeFilters.minCostCents;
        if (ieeFilters.search)       params.search       = ieeFilters.search;
        const { data } = await api.get(`/api/subaccounts/${subaccountId}/iee/usage`, { params });
        setIeeRows(data.rows ?? []);
        setIeeSummary(data.summary ?? null);
      }
    } catch { /* ignore */ }
    finally { setTabLoading(false); }
  }, [subaccountId, month, routingFilters, ieeFilters]);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  const monthlySpent = summary?.monthly?.totalCostCents ?? 0;
  const todaySpent   = summary?.today?.totalCostCents ?? 0;
  const monthLimit   = summary?.limits?.monthlyCostLimitCents ?? null;
  const dailyLimit   = summary?.limits?.dailyCostLimitCents ?? null;

  const shimmer = 'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded-lg';

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both] max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        {!embedded && (
        <div>
          <h1 className="text-[26px] font-extrabold text-slate-900 tracking-tight m-0">Usage & Costs</h1>
          <p className="text-sm text-slate-500 mt-1">
            LLM spending, token usage, and budget tracking
            <span className="ml-2 text-[11px] text-slate-400 font-normal">(cost totals update within ~30s of activity)</span>
          </p>
        </div>
        )}

        {/* Month navigator */}
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
          <button
            onClick={() => setMonth(m => prevMonth(m))}
            className="text-slate-400 hover:text-slate-700 bg-transparent border-0 cursor-pointer flex items-center p-0.5"
          >
            <ChevLeft />
          </button>
          <span className="text-[13px] font-semibold text-slate-700 min-w-[130px] text-center">
            {monthLabel(month)}
          </span>
          <button
            onClick={() => setMonth(m => nextMonth(m))}
            disabled={month >= thisMonth}
            className="text-slate-400 hover:text-slate-700 bg-transparent border-0 cursor-pointer flex items-center p-0.5 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevRight />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          {
            label: 'Month Spend',
            value: loading ? null : formatCents(monthlySpent),
            sub: monthLimit ? `of ${formatCents(monthLimit)} limit` : 'no limit set',
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            ),
            iconBg: 'bg-indigo-50', iconColor: 'text-indigo-500',
          },
          {
            label: 'Today',
            value: loading ? null : formatCents(todaySpent),
            sub: dailyLimit ? `of ${formatCents(dailyLimit)} daily limit` : 'no daily limit',
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            ),
            iconBg: 'bg-blue-50', iconColor: 'text-blue-500',
          },
          {
            label: 'LLM Requests',
            value: loading ? null : (summary?.monthly?.requestCount ?? 0).toLocaleString(),
            sub: summary?.monthly?.errorCount ? `${summary.monthly.errorCount} errors` : 'no errors',
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            ),
            iconBg: 'bg-emerald-50', iconColor: 'text-emerald-500',
          },
          {
            label: 'Tokens Used',
            value: loading ? null : formatTokens((summary?.monthly?.tokensIn ?? 0) + (summary?.monthly?.tokensOut ?? 0)),
            sub: loading ? '' : `${formatTokens(summary?.monthly?.tokensIn ?? 0)} in · ${formatTokens(summary?.monthly?.tokensOut ?? 0)} out`,
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              </svg>
            ),
            iconBg: 'bg-violet-50', iconColor: 'text-violet-500',
          },
        ].map(card => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${card.iconBg} ${card.iconColor}`}>
                {card.icon}
              </div>
              {card.value === null
                ? <div className={`h-7 w-16 ${shimmer}`} />
                : <div className="text-[22px] font-extrabold text-slate-900 leading-none">{card.value}</div>
              }
            </div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{card.label}</div>
            {card.sub && <div className="text-[11px] text-slate-400 mt-0.5">{card.sub}</div>}
          </div>
        ))}
      </div>

      {/* Budget bars */}
      {(monthLimit || dailyLimit) && !loading && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <h3 className="text-[13px] font-bold text-slate-700 mb-0">Budget Limits</h3>
          <BudgetBar spent={monthlySpent} limit={monthLimit} label="Monthly budget" />
          <BudgetBar spent={todaySpent}   limit={dailyLimit} label="Daily budget" />
        </div>
      )}

      {/* Run activity chart */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-[14px] font-bold text-slate-900 m-0">Run Activity</h3>
            <p className="text-[11px] text-slate-400 mt-0.5 m-0">Rolling 14-day window — independent of the month selector above</p>
          </div>
          <span className="text-[12px] text-slate-400">
            {daily.reduce((s, d) => s + d.total, 0)} total runs
          </span>
        </div>
        {loading
          ? <div className={`h-[140px] w-full ${shimmer}`} />
          : <RunActivityChart data={daily} />
        }
      </div>

      {/* Tabs */}
      <TabBar active={tab} onChange={setTab} />

      {/* Tab: Overview */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="text-[14px] font-bold text-slate-900 m-0">Invoice Summary — {monthLabel(month)}</h3>
            </div>
            <div className="p-5 text-sm text-slate-500">
              <div className="flex justify-between py-2 border-b border-slate-50">
                <span>Total LLM cost</span>
                <span className="font-semibold text-slate-900">{formatCents(monthlySpent)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-50">
                <span>Requests</span>
                <span className="font-semibold text-slate-900">{(summary?.monthly?.requestCount ?? 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-50">
                <span>Errors</span>
                <span className={`font-semibold ${(summary?.monthly?.errorCount ?? 0) > 0 ? 'text-red-600' : 'text-slate-900'}`}>
                  {summary?.monthly?.errorCount ?? 0}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span>Today</span>
                <span className="font-semibold text-slate-900">{formatCents(todaySpent)}</span>
              </div>
            </div>
          </div>

          {(summary?.limits?.maxCostPerRunCents) && (
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-[14px] font-bold text-slate-900 m-0 mb-3">Run Limits</h3>
              <div className="flex justify-between text-sm py-2">
                <span className="text-slate-500">Max cost per run</span>
                <span className="font-semibold text-slate-900">{formatCents(summary.limits.maxCostPerRunCents)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Agents */}
      {tab === 'agents' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Agent</th>
                <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Requests</th>
                <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tokens In</th>
                <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tokens Out</th>
                <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {tabLoading ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(5)].map((_, j) => (
                      <td key={j} className="px-5 py-3">
                        <div className={`h-4 rounded ${shimmer}`} style={{ width: j === 0 ? '120px' : '60px' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : agents.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400 text-sm">No agent activity this period</td></tr>
              ) : (
                agents.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-900">{row.agentName ?? '—'}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{row.requestCount.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{formatTokens(row.totalTokensIn)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{formatTokens(row.totalTokensOut)}</td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-900">{formatCents(row.totalCostCents)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {agents.length > 0 && !tabLoading && (
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50/50">
                  <td className="px-5 py-3 font-bold text-slate-700">Total</td>
                  <td className="px-5 py-3 text-right font-bold text-slate-700">
                    {agents.reduce((s, r) => s + r.requestCount, 0).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right font-bold text-slate-700">
                    {formatTokens(agents.reduce((s, r) => s + r.totalTokensIn, 0))}
                  </td>
                  <td className="px-5 py-3 text-right font-bold text-slate-700">
                    {formatTokens(agents.reduce((s, r) => s + r.totalTokensOut, 0))}
                  </td>
                  <td className="px-5 py-3 text-right font-bold text-slate-900">
                    {formatCents(agents.reduce((s, r) => s + r.totalCostCents, 0))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Tab: Models */}
      {tab === 'models' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Provider / Model</th>
                <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Requests</th>
                <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tokens In</th>
                <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tokens Out</th>
                <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Avg Latency</th>
                <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {tabLoading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(6)].map((_, j) => (
                      <td key={j} className="px-5 py-3">
                        <div className={`h-4 rounded ${shimmer}`} style={{ width: j === 0 ? '160px' : '60px' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : models.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400 text-sm">No model usage this period</td></tr>
              ) : (
                models.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-900">{row.model}</div>
                      <div className="text-[11px] text-slate-400 capitalize">{row.provider}</div>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">{row.requestCount.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{formatTokens(row.totalTokensIn)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{formatTokens(row.totalTokensOut)}</td>
                    <td className="px-5 py-3 text-right text-slate-400 text-[12px]">
                      {row.avgLatencyMs ? `${(row.avgLatencyMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-900">{formatCents(row.totalCostCents)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Runs */}
      {tab === 'runs' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[13px] font-bold text-slate-700">Last 50 runs by cost</span>
            <span className="text-[12px] text-slate-400">All time</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Run ID</th>
                <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Requests</th>
                <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Cost</th>
                <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Last Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {tabLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(4)].map((_, j) => (
                      <td key={j} className="px-5 py-3">
                        <div className={`h-4 rounded ${shimmer}`} style={{ width: j === 0 ? '100px' : '70px' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : runs.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400 text-sm">No run cost data yet</td></tr>
              ) : (
                runs.map(run => (
                  <tr key={run.entityId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <Link
                        to={`/admin/subaccounts/${subaccountId}/runs/${run.entityId}`}
                        className="font-mono text-[12px] text-indigo-600 hover:text-indigo-700 no-underline"
                      >
                        {run.entityId.substring(0, 8)}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">{run.requestCount}</td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-900">{formatCents(run.totalCostCents)}</td>
                    <td className="px-5 py-3 text-right text-slate-400 text-[12px]">
                      {new Date(run.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Routing */}
      {tab === 'routing' && (
        <RoutingTab
          subaccountId={subaccountId!}
          month={month}
          distribution={routingDist}
          log={routingLog}
          nextCursor={routingNextCursor}
          nextCursorId={routingNextCursorId}
          loadingMore={routingLoadingMore}
          selectedRequest={selectedRequest}
          filters={routingFilters}
          tabLoading={tabLoading}
          shimmer={shimmer}
          onFilterChange={(f) => { setRoutingFilters(f); }}
          onLoadMore={async () => {
            if (!routingNextCursor || !subaccountId) return;
            setRoutingLoadingMore(true);
            try {
              const params: Record<string, string> = { month, ...routingFilters, cursor: routingNextCursor, cursorId: routingNextCursorId! };
              const { data } = await api.get(`/api/subaccounts/${subaccountId}/usage/routing-log`, { params });
              setRoutingLog(prev => [...prev, ...(data.items ?? [])]);
              setRoutingNextCursor(data.nextCursor);
              setRoutingNextCursorId(data.nextCursorId);
            } catch { /* ignore */ }
            finally { setRoutingLoadingMore(false); }
          }}
          onSelectRequest={setSelectedRequest}
        />
      )}

      {/* Tab: IEE Execution (rev 6 §11.8) */}
      {tab === 'iee' && (
        <IeeTab
          subaccountId={subaccountId!}
          rows={ieeRows}
          summary={ieeSummary}
          tabLoading={tabLoading}
          filters={ieeFilters}
          onFilterChange={setIeeFilters}
        />
      )}
    </div>
  );
}

// ─── IEE tab ──────────────────────────────────────────────────────────────────
//
// Single tab on the existing UsagePage for the Integrated Execution
// Environment surface. Reuses the page-level month picker and TabBar — only
// the inner content (filters + summary cards + runs table) is IEE-specific.
//
// Spec §11.8.6 — single endpoint /api/subaccounts/:id/iee/usage backs this.

interface IeeTabProps {
  subaccountId: string;
  rows: IeeUsageRow[];
  summary: IeeUsageSummary | null;
  tabLoading: boolean;
  filters: { types: string; statuses: string; minCostCents: string; search: string };
  onFilterChange: (f: { types: string; statuses: string; minCostCents: string; search: string }) => void;
}

function IeeTab({ rows, summary, tabLoading, filters, onFilterChange }: IeeTabProps) {
  const setF = (k: keyof IeeTabProps['filters'], v: string) => onFilterChange({ ...filters, [k]: v });
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
            {tabLoading ? (
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

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3">
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="text-[20px] font-extrabold text-slate-900 mt-1 tabular-nums">{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}

// ─── Routing tab ──────────────────────────────────────────────────────────────

type FallbackChainEntry = { provider: string; model: string; error?: string; success?: boolean };

function parseFallbackChain(raw: string | null): FallbackChainEntry[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as FallbackChainEntry[] : null;
  } catch { return null; }
}

const ANOMALY_THRESHOLDS = {
  fallback:   { warn: 0.05, danger: 0.15 },
  escalation: { warn: 0.10, danger: 0.25 },
};

function anomalyColor(value: number, thresholds: { warn: number; danger: number }): string {
  if (value >= thresholds.danger) return 'text-red-600 bg-red-50 border-red-200';
  if (value >= thresholds.warn) return 'text-amber-600 bg-amber-50 border-amber-200';
  return 'text-emerald-600 bg-emerald-50 border-emerald-200';
}

const TIER_COLORS: Record<string, string> = { frontier: 'bg-indigo-100 text-indigo-700', economy: 'bg-emerald-100 text-emerald-700' };
const REASON_COLORS: Record<string, string> = { forced: 'bg-purple-100 text-purple-700', ceiling: 'bg-blue-100 text-blue-700', economy: 'bg-emerald-100 text-emerald-700', fallback: 'bg-amber-100 text-amber-700' };
const STATUS_COLORS: Record<string, string> = { success: 'bg-emerald-100 text-emerald-700', error: 'bg-red-100 text-red-700', timeout: 'bg-amber-100 text-amber-700', budget_blocked: 'bg-orange-100 text-orange-700', rate_limited: 'bg-yellow-100 text-yellow-700', provider_unavailable: 'bg-slate-100 text-slate-700', provider_not_configured: 'bg-slate-100 text-slate-600', partial: 'bg-blue-100 text-blue-700' };

function Badge({ label, colorMap }: { label: string | null; colorMap: Record<string, string> }) {
  if (!label) return <span className="text-slate-400">—</span>;
  const cls = colorMap[label] ?? 'bg-slate-100 text-slate-600';
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>{label}</span>;
}

function DistributionBar({ label, items }: { label: string; items: { name: string; count: number; cost: number; color: string }[] }) {
  const totalCount = items.reduce((s, i) => s + i.count, 0) || 1;
  return (
    <div className="mb-4">
      <div className="text-[12px] font-semibold text-slate-700 mb-1.5">{label}</div>
      <div className="flex h-5 rounded-full overflow-hidden bg-slate-100">
        {items.filter(i => i.count > 0).map(item => (
          <div
            key={item.name}
            className={`${item.color} flex items-center justify-center text-[10px] font-bold text-white transition-all duration-500`}
            style={{ width: `${Math.max((item.count / totalCount) * 100, 2)}%` }}
            title={`${item.name}: ${item.count} requests (${formatCents(item.cost)})`}
          >
            {(item.count / totalCount) > 0.08 ? item.name : ''}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
        {items.filter(i => i.count > 0).map(item => (
          <span key={item.name} className="text-[11px] text-slate-500">
            <span className={`inline-block w-2 h-2 rounded-full mr-1 ${item.color}`} />
            {item.name}: {item.count} ({Math.round((item.count / totalCount) * 100)}%) {item.cost > 0 ? `· ${formatCents(item.cost)}` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

interface RoutingTabProps {
  subaccountId: string;
  month: string;
  distribution: RoutingDistribution | null;
  log: RoutingLogItem[];
  nextCursor: string | null;
  nextCursorId: string | null;
  loadingMore: boolean;
  selectedRequest: RoutingLogItem | null;
  filters: Record<string, string>;
  tabLoading: boolean;
  shimmer: string;
  onFilterChange: (f: Record<string, string>) => void;
  onLoadMore: () => void;
  onSelectRequest: (r: RoutingLogItem | null) => void;
}

function RoutingTab({ distribution: dist, log, nextCursor, loadingMore, selectedRequest, filters, tabLoading, shimmer, onFilterChange, onLoadMore, onSelectRequest }: RoutingTabProps) {
  if (tabLoading && !dist) {
    return (
      <div className="space-y-4">
        <div className={`h-20 ${shimmer}`} />
        <div className={`h-48 ${shimmer}`} />
        <div className={`h-64 ${shimmer}`} />
      </div>
    );
  }

  const setFilter = (key: string, value: string) => {
    const next = { ...filters };
    if (value) next[key] = value;
    else delete next[key];
    onFilterChange(next);
  };

  return (
    <div className="space-y-4">
      {/* Anomaly flags */}
      {dist && dist.totalRequests > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Fallback Rate', value: dist.fallbackPct, thresholds: ANOMALY_THRESHOLDS.fallback, desc: 'of requests required provider fallback' },
            { label: 'Escalation Rate', value: dist.escalationPct, thresholds: ANOMALY_THRESHOLDS.escalation, desc: 'of requests escalated from economy to frontier' },
            { label: 'Economy Usage', value: dist.downgradePct, thresholds: { warn: 2, danger: 2 }, desc: 'of requests used economy tier' },
          ].map(flag => (
            <div key={flag.label} className={`border rounded-xl px-4 py-3 ${flag.label === 'Economy Usage' ? 'text-slate-600 bg-slate-50 border-slate-200' : anomalyColor(flag.value, flag.thresholds)}`}>
              <div className="text-[20px] font-extrabold">{Math.round(flag.value * 100)}%</div>
              <div className="text-[11px] font-bold uppercase tracking-wider mt-0.5">{flag.label}</div>
              <div className="text-[11px] mt-0.5 opacity-75">{flag.desc}</div>
            </div>
          ))}
        </div>
      )}

      {/* Distribution charts */}
      {dist && dist.totalRequests > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-bold text-slate-900 m-0">Routing Distribution</h3>
            <div className="text-[13px] text-slate-500">
              <span className="font-semibold text-slate-900">{formatCents(dist.totalCostCents)}</span>
              <span className="mx-1.5 text-slate-300">·</span>
              {dist.totalRequests.toLocaleString()} requests
            </div>
          </div>

          <DistributionBar
            label="Capability Tier"
            items={[
              { name: 'frontier', count: dist.byTier.frontier, cost: dist.costByTier.frontier, color: 'bg-indigo-400' },
              { name: 'economy', count: dist.byTier.economy, cost: dist.costByTier.economy, color: 'bg-emerald-400' },
            ]}
          />
          <DistributionBar
            label="Routing Reason"
            items={Object.entries(dist.byReason).map(([name, count]) => ({
              name, count, cost: dist.costByReason[name] ?? 0,
              color: name === 'forced' ? 'bg-purple-400' : name === 'ceiling' ? 'bg-blue-400' : name === 'economy' ? 'bg-emerald-400' : 'bg-amber-400',
            }))}
          />
          <DistributionBar
            label="Status"
            items={Object.entries(dist.byStatus).map(([name, count]) => ({
              name, count, cost: 0,
              color: name === 'success' ? 'bg-emerald-400' : name === 'error' ? 'bg-red-400' : name === 'timeout' ? 'bg-amber-400' : 'bg-slate-400',
            }))}
          />
          <DistributionBar
            label="Execution Phase"
            items={Object.entries(dist.byPhase).map(([name, count]) => ({
              name, count, cost: 0,
              color: name === 'planning' ? 'bg-blue-400' : name === 'execution' ? 'bg-emerald-400' : 'bg-violet-400',
            }))}
          />

          {/* Latency summary */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <h4 className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-2">Avg Model Time</h4>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
              <span className="text-slate-500">Frontier: <span className="font-semibold text-slate-700">{dist.latencyByTier.frontier ? `${(dist.latencyByTier.frontier / 1000).toFixed(1)}s` : '—'}</span></span>
              <span className="text-slate-500">Economy: <span className="font-semibold text-slate-700">{dist.latencyByTier.economy ? `${(dist.latencyByTier.economy / 1000).toFixed(1)}s` : '—'}</span></span>
              {Object.entries(dist.latencyByProvider).map(([p, ms]) => (
                <span key={p} className="text-slate-500 capitalize">{p}: <span className="font-semibold text-slate-700">{ms ? `${(ms / 1000).toFixed(1)}s` : '—'}</span></span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex flex-wrap gap-2 items-center">
          <FilterSelect label="Provider" value={filters.provider} options={dist ? Object.keys(dist.byProvider) : []} onChange={v => setFilter('provider', v)} />
          <FilterSelect label="Reason" value={filters.routingReason} options={['forced', 'ceiling', 'economy', 'fallback']} onChange={v => setFilter('routingReason', v)} />
          <FilterSelect label="Tier" value={filters.capabilityTier} options={['frontier', 'economy']} onChange={v => setFilter('capabilityTier', v)} />
          <FilterSelect label="Phase" value={filters.executionPhase} options={['planning', 'execution', 'synthesis']} onChange={v => setFilter('executionPhase', v)} />
          <FilterSelect label="Status" value={filters.status} options={dist ? Object.keys(dist.byStatus) : []} onChange={v => setFilter('status', v)} />
          <FilterSelect label="Downgraded" value={filters.wasDowngraded} options={['true', 'false']} onChange={v => setFilter('wasDowngraded', v)} />
          <FilterSelect label="Escalated" value={filters.wasEscalated} options={['true', 'false']} onChange={v => setFilter('wasEscalated', v)} />
          <FilterText label="Agent" value={filters.agentName} onChange={v => setFilter('agentName', v)} />
          <FilterText label="Run ID" value={filters.runId} onChange={v => setFilter('runId', v)} />
          {Object.keys(filters).length > 0 && (
            <button onClick={() => onFilterChange({})} className="text-[11px] text-indigo-600 hover:text-indigo-800 bg-transparent border-0 cursor-pointer font-semibold [font-family:inherit]">
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Request log table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Time</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Agent</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Provider / Model</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Phase</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tier</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Reason</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status</th>
              <th className="text-right px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Model Time</th>
              <th className="text-right px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {tabLoading && log.length === 0 ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}>
                  {[...Array(9)].map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className={`h-4 rounded ${shimmer}`} style={{ width: j === 2 ? '140px' : '60px' }} /></td>
                  ))}
                </tr>
              ))
            ) : log.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-5 py-12 text-center">
                  <div className="text-slate-400 text-sm">No routing data for this period.</div>
                  <div className="text-slate-400 text-[12px] mt-1">Try expanding the date range or removing filters.</div>
                </td>
              </tr>
            ) : (
              log.map(row => {
                const hadFallback = row.requestedProvider && row.requestedModel && (row.requestedProvider !== row.provider || row.requestedModel !== row.model);
                const fallbackChainParsed = parseFallbackChain(row.fallbackChain);
                const failedAfterN = row.status !== 'success' && fallbackChainParsed && !fallbackChainParsed.some(a => a.success);
                return (
                  <tr
                    key={row.id}
                    onClick={() => onSelectRequest(selectedRequest?.id === row.id ? null : row)}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-2.5 text-[12px] text-slate-500 whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-slate-700 font-medium max-w-[120px] truncate">{row.agentName ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      {hadFallback ? (
                        <div className="text-[12px]">
                          <span className="text-slate-400">{row.requestedProvider}/{row.requestedModel}</span>
                          <span className="text-slate-300 mx-1">&rarr;</span>
                          <span className="text-slate-900 font-medium">{row.provider}/{row.model}</span>
                        </div>
                      ) : (
                        <div className="text-[12px] text-slate-900 font-medium">{row.provider}/{row.model}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5"><Badge label={row.executionPhase} colorMap={{ planning: 'bg-blue-100 text-blue-700', execution: 'bg-emerald-100 text-emerald-700', synthesis: 'bg-violet-100 text-violet-700' }} /></td>
                    <td className="px-4 py-2.5"><Badge label={row.capabilityTier} colorMap={TIER_COLORS} /></td>
                    <td className="px-4 py-2.5"><Badge label={row.routingReason} colorMap={REASON_COLORS} /></td>
                    <td className="px-4 py-2.5">
                      {failedAfterN
                        ? <span className="text-[11px] font-semibold text-red-600">Failed after {fallbackChainParsed!.length} attempts</span>
                        : <Badge label={row.status} colorMap={STATUS_COLORS} />
                      }
                    </td>
                    <td className="px-4 py-2.5 text-right text-[12px] text-slate-500">
                      {row.providerLatencyMs ? `${(row.providerLatencyMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[12px] font-semibold text-slate-900">{formatCents(row.costWithMarginCents)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {nextCursor && (
          <div className="px-5 py-3 border-t border-slate-100 text-center">
            <button
              onClick={onLoadMore}
              disabled={loadingMore}
              className="text-[13px] font-semibold text-indigo-600 hover:text-indigo-800 bg-transparent border-0 cursor-pointer disabled:opacity-50 [font-family:inherit]"
            >
              {loadingMore ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </div>

      {/* Request detail drawer */}
      {selectedRequest && (
        <RequestDetailDrawer request={selectedRequest} onClose={() => onSelectRequest(null)} />
      )}
    </div>
  );
}

// ─── Filter controls ──────────────────────────────────────────────────────────

function FilterSelect({ label, value, options, onChange }: { label: string; value?: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      className="text-[12px] border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 [font-family:inherit] cursor-pointer"
    >
      <option value="">{label}: Any</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function FilterText({ label, value, onChange }: { label: string; value?: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      placeholder={label}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className="text-[12px] border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 w-[110px] [font-family:inherit] placeholder:text-slate-400"
    />
  );
}

// ─── Request detail drawer ────────────────────────────────────────────────────

function RequestDetailDrawer({ request: r, onClose }: { request: RoutingLogItem; onClose: () => void }) {
  const fallbackChain = parseFallbackChain(r.fallbackChain);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 animate-[fadeIn_0.15s_ease-out_both]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[14px] font-bold text-slate-900 m-0">Request Detail</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 bg-transparent border-0 cursor-pointer text-[18px] leading-none">&times;</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-[12px]">
        <DetailField label="ID" value={r.id} mono />
        <DetailField label="Idempotency Key" value={r.idempotencyKey} mono />
        <DetailField label="Run ID" value={r.runId} mono />
        <DetailField label="Execution ID" value={r.executionId} mono />
        <DetailField label="Task Type" value={r.taskType} />
        <DetailField label="Agent" value={r.agentName} />
        <DetailField label="Created At" value={new Date(r.createdAt).toLocaleString()} />
        <DetailField label="Status" value={r.status} />
        <DetailField label="Execution Phase" value={r.executionPhase} />
        <DetailField label="Capability Tier" value={r.capabilityTier} />
        <DetailField label="Routing Reason" value={r.routingReason} />
        <DetailField label="Was Downgraded" value={String(r.wasDowngraded)} />
        <DetailField label="Was Escalated" value={String(r.wasEscalated)} />
        {r.escalationReason && <DetailField label="Escalation Reason" value={r.escalationReason} />}
      </div>

      {/* Provider routing */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        <h4 className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-2">Provider Routing</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-[12px]">
          <DetailField label="Requested" value={r.requestedProvider && r.requestedModel ? `${r.requestedProvider}/${r.requestedModel}` : '—'} />
          <DetailField label="Actual" value={`${r.provider}/${r.model}`} />
          <DetailField label="Model Time" value={r.providerLatencyMs ? `${(r.providerLatencyMs / 1000).toFixed(2)}s` : '—'} />
          <DetailField label="Routing Time" value={r.routerOverheadMs ? `${r.routerOverheadMs}ms` : '—'} />
        </div>
      </div>

      {/* Fallback chain timeline */}
      {fallbackChain && fallbackChain.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <h4 className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-2">Fallback Chain</h4>
          <div className="space-y-1.5">
            {fallbackChain.map((attempt, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${attempt.success ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span className="font-medium text-slate-700">{attempt.provider}/{attempt.model}</span>
                {attempt.error && <span className="text-red-500 truncate">{attempt.error}</span>}
                {attempt.success && <span className="text-emerald-600 font-semibold">Success</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tokens & cost */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        <h4 className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-2">Tokens & Cost</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-[12px]">
          <DetailField label="Tokens In" value={formatTokens(r.tokensIn)} />
          <DetailField label="Tokens Out" value={formatTokens(r.tokensOut)} />
          <DetailField label="Cached Tokens" value={formatTokens(r.cachedPromptTokens)} />
          <DetailField label="Raw Cost" value={`$${Number(r.costRaw).toFixed(6)}`} />
          <DetailField label="Cost w/ Margin" value={`$${Number(r.costWithMargin).toFixed(6)}`} />
          <DetailField label="Margin" value={`${r.marginMultiplier}x`} />
          <DetailField label="Final Cost" value={formatCents(r.costWithMarginCents)} />
        </div>
      </div>

      {/* Hashes */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        <h4 className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-2">Audit Hashes</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-[12px]">
          <DetailField label="Request Hash" value={r.requestPayloadHash} mono />
          <DetailField label="Response Hash" value={r.responsePayloadHash} mono />
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <div className="text-slate-400 font-semibold mb-0.5">{label}</div>
      <div className={`text-slate-900 ${mono ? 'font-mono text-[11px] break-all' : ''}`}>{value ?? '—'}</div>
    </div>
  );
}
