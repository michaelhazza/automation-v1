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

type Tab = 'overview' | 'agents' | 'models' | 'runs';

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'agents',   label: 'Agents' },
    { id: 'models',   label: 'Models' },
    { id: 'runs',     label: 'Runs' },
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
    }).catch(() => {}).finally(() => setLoading(false));
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
      }
    } catch { /* ignore */ }
    finally { setTabLoading(false); }
  }, [subaccountId, month]);

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
    </div>
  );
}
