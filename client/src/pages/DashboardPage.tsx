import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import MetricCard from '../components/MetricCard';
import { RunActivityChart } from '../components/ActivityCharts';
import HealthAuditWidget from '../components/HealthAuditWidget';

interface Agent { id: string; name: string; description?: string; icon?: string; status: string; }
interface Execution {
  id: string; processId: string; status: string; createdAt: string;
  durationMs: number | null; isTestExecution: boolean;
}
interface ActivityStats {
  totalRuns: number; completedRuns: number; failedRuns: number;
  totalTokens: number; totalToolCalls: number;
  totalItemsCreated: number; totalItemsUpdated: number; totalDeliverables: number;
  avgDurationMs: number;
}
interface DayBucket {
  date: string; completed: number; failed: number; timeout: number; other: number; total: number;
}

const DEFAULT_ICONS = ['\u{1F50D}','\u{1F4CA}','\u{1F4DD}','\u{1F4E3}','\u{1F916}','\u{2699}\uFE0F','\u{1F4AC}','\u{1F4C8}','\u{2728}','\u{1F3AF}'];
function getDefaultIcon(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return DEFAULT_ICONS[Math.abs(h) % DEFAULT_ICONS.length];
}

const STATUS_STYLES: Record<string, string> = {
  running:   'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  failed:    'bg-red-50 text-red-700 border-red-200',
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  timeout:   'bg-orange-50 text-orange-700 border-orange-200',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

export default function DashboardPage({ user }: { user: User }) {
  const [agents, setAgents]         = useState<Agent[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [stats, setStats]           = useState<ActivityStats | null>(null);
  const [daily, setDaily]           = useState<DayBucket[]>([]);
  const [loading, setLoading]       = useState(true);
  const navigate = useNavigate();

  // Track execution IDs we've already seen so we can animate new ones
  const seenIds = useRef(new Set<string>());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([
      api.get('/api/agents'),
      api.get('/api/executions', { params: { limit: 8 } }),
      api.get('/api/agent-activity/stats', { params: { sinceDays: 7 } }).catch((err) => { console.error('[Dashboard] Failed to fetch activity stats:', err); return { data: null }; }),
      api.get('/api/agent-activity/daily', { params: { sinceDays: 14 } }).catch((err) => { console.error('[Dashboard] Failed to fetch daily activity:', err); return { data: [] }; }),
    ]).then(([a, e, s, d]) => {
      setAgents(a.data);
      const execs: Execution[] = e.data;
      setExecutions(execs);
      setStats(s.data);
      setDaily(d.data);

      // Animate entries that weren't seen before
      const fresh = new Set<string>();
      execs.forEach(ex => { if (!seenIds.current.has(ex.id)) fresh.add(ex.id); });
      if (fresh.size > 0) {
        setNewIds(fresh);
        fresh.forEach(id => seenIds.current.add(id));
        setTimeout(() => setNewIds(new Set()), 980);
      }
    }).catch((err) => console.error('[Dashboard] Failed to load dashboard data:', err)).finally(() => setLoading(false));
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const activeAgents = agents.filter(a => a.status === 'active');
  const successRate = stats && stats.totalRuns > 0
    ? Math.round((stats.completedRuns / stats.totalRuns) * 100)
    : null;

  // Trend: compare yesterday vs day-before-yesterday using daily data
  const today     = daily.length >= 1 ? daily[daily.length - 1] : null;
  const yesterday = daily.length >= 2 ? daily[daily.length - 2] : null;
  const todayRuns = today?.total ?? 0;
  const yestRuns  = yesterday?.total ?? 0;
  const runsDelta = yestRuns > 0 ? todayRuns - yestRuns : null;

  const todaySuccessRate = today && today.total > 0
    ? Math.round((today.completed / today.total) * 100)
    : null;
  const yestSuccessRate = yesterday && yesterday.total > 0
    ? Math.round((yesterday.completed / yesterday.total) * 100)
    : null;
  const rateDelta = todaySuccessRate !== null && yestSuccessRate !== null
    ? todaySuccessRate - yestSuccessRate
    : null;

  const shimmer = 'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded-md';

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <div className={`h-9 w-64 ${shimmer}`} />
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
          {[1,2,3,4].map(i => <div key={i} className={`h-[88px] rounded-xl ${shimmer}`} />)}
        </div>
        <div className={`h-52 rounded-xl ${shimmer}`} />
        <div className={`h-48 rounded-xl ${shimmer}`} />
      </div>
    );
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      {/* Greeting */}
      <div className="mb-6">
        <h1 className="text-[28px] font-extrabold text-slate-900 tracking-tight m-0">
          {greeting}, {user.firstName}
        </h1>
        <p className="text-sm text-slate-500 mt-1.5">
          {activeAgents.length > 0
            ? `${activeAgents.length} AI agent${activeAgents.length === 1 ? '' : 's'} ready to work.`
            : "Let's get your AI team set up."}
        </p>
      </div>

      {/* ── Metric cards ──────────────────────────────────────────────────── */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))] mb-6">
        <MetricCard
          label="Active Agents"
          value={activeAgents.length}
          sub={agents.length > activeAgents.length ? `${agents.length - activeAgents.length} inactive` : 'all ready'}
          to="/agents"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a5 5 0 1 0 0 10A5 5 0 0 0 12 2z"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
              <circle cx="18" cy="8" r="3"/><path d="M21 6l-1 1-1-1"/>
            </svg>
          }
          iconBg="bg-indigo-50" iconColor="text-indigo-500"
        />

        <MetricCard
          label="Runs (7 days)"
          value={stats?.totalRuns ?? 0}
          sub={runsDelta !== null
            ? `${runsDelta > 0 ? '↑' : runsDelta < 0 ? '↓' : '→'} ${Math.abs(runsDelta)} vs yesterday`
            : stats?.failedRuns ? `${stats.failedRuns} failed` : 'all good'
          }
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          }
          iconBg="bg-emerald-50" iconColor="text-emerald-500"
        />

        <MetricCard
          label="Success Rate"
          value={successRate !== null ? `${successRate}%` : '—'}
          sub={rateDelta !== null
            ? `${rateDelta > 0 ? '↑' : rateDelta < 0 ? '↓' : '→'} ${Math.abs(rateDelta)}pp vs yesterday`
            : stats?.totalRuns ? `${stats.completedRuns} of ${stats.totalRuns} runs` : 'no runs yet'
          }
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          }
          iconBg={successRate !== null && successRate < 80 ? 'bg-amber-50' : 'bg-green-50'}
          iconColor={successRate !== null && successRate < 80 ? 'text-amber-500' : 'text-green-500'}
        />

        <MetricCard
          label="Items Created"
          value={(stats?.totalItemsCreated ?? 0) + (stats?.totalDeliverables ?? 0)}
          sub={stats?.totalItemsUpdated ? `${stats.totalItemsUpdated} updated` : 'this week'}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
          }
          iconBg="bg-blue-50" iconColor="text-blue-500"
        />
      </div>

      {/* ── System admin: Queue health summary ───────────────────────────── */}
      {user.role === 'system_admin' && (
        <QueueHealthSummary />
      )}

      {/* ── Brain Tree OS adoption P4 — workspace health widget ────────────── */}
      <div className="mb-6">
        <HealthAuditWidget />
      </div>

      {/* ── Run activity chart ─────────────────────────────────────────────── */}
      {daily.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-bold text-slate-900 tracking-tight m-0">Run Activity</h2>
            <span className="text-[12px] text-slate-400">Last 14 days</span>
          </div>
          <RunActivityChart data={daily} height={120} />
        </div>
      )}

      {/* ── Quick Chat agents ─────────────────────────────────────────────── */}
      {activeAgents.length > 0 && (
        <div className="mb-8">
          <div className="flex justify-between items-center mb-3.5">
            <h2 className="text-[17px] font-bold text-slate-900 tracking-tight m-0">Quick Chat</h2>
            <Link to="/agents" className="text-[13px] text-indigo-600 hover:text-indigo-700 font-semibold no-underline">
              View all →
            </Link>
          </div>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {activeAgents.slice(0, 6).map((agent) => (
              <div
                key={agent.id}
                onClick={() => navigate(`/agents/${agent.id}`)}
                className="bg-white border-2 border-slate-100 rounded-xl p-4 flex items-center gap-3 cursor-pointer hover:border-indigo-200 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150"
              >
                <div className="w-11 h-11 rounded-xl shrink-0 flex items-center justify-center text-[22px] bg-[linear-gradient(135deg,#f5f3ff,#ede9fe)]">
                  {agent.icon || getDefaultIcon(agent.id)}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-slate-900 text-sm truncate">{agent.name}</div>
                  {agent.description && <div className="text-xs text-slate-400 truncate">{agent.description}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {agents.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-12 mb-8 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-4 bg-[linear-gradient(135deg,#f5f3ff,#ede9fe)]">
            🤖
          </div>
          <p className="font-bold text-[17px] text-slate-900 mb-2">Welcome to Automation OS</p>
          <p className="text-sm text-slate-500 max-w-sm leading-relaxed">
            Your AI team will appear here once they are set up.
            Ask your administrator to create agents and assign them to your account.
          </p>
        </div>
      )}

      {/* ── Recent activity ───────────────────────────────────────────────── */}
      {executions.length > 0 && (
        <div>
          <div className="flex justify-between items-center mb-3.5">
            <h2 className="text-[17px] font-bold text-slate-900 tracking-tight m-0">Recent Activity</h2>
            <Link to="/admin/activity" className="text-[13px] text-indigo-600 hover:text-indigo-700 font-semibold no-underline">
              View all →
            </Link>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Run</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Duration</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {executions.map((exec) => (
                  <tr
                    key={exec.id}
                    className={`transition-colors ${
                      newIds.has(exec.id)
                        ? 'animate-[fadeIn_0.35s_ease-out_both] bg-indigo-50/40'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="px-5 py-3">
                      <Link to={`/executions/${exec.id}`} className="text-indigo-600 hover:text-indigo-700 text-xs font-semibold font-mono no-underline">
                        {exec.id.substring(0, 8)}
                      </Link>
                    </td>
                    <td className="px-5 py-3"><StatusBadge status={exec.status} /></td>
                    <td className="px-5 py-3 text-slate-500 text-[13px]">
                      {exec.durationMs != null ? `${(exec.durationMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-[13px]">
                      {new Date(exec.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Queue Health Summary (system admin only) ──────────────────────────────

function QueueHealthSummary() {
  const [data, setData] = useState<{ pending: number; dlq: number; failed: number } | null>(null);

  useEffect(() => {
    api.get('/api/system/job-queues')
      .then(res => {
        const queues = res.data as Array<{ pending: number; dlqDepth: number; failed: number }>;
        setData({
          pending: queues.reduce((s, q) => s + q.pending, 0),
          dlq: queues.reduce((s, q) => s + q.dlqDepth, 0),
          failed: queues.reduce((s, q) => s + q.failed, 0),
        });
      })
      .catch(() => {});
  }, []);

  if (!data) return null;

  const color = data.dlq > 0 || data.failed > 10
    ? 'border-amber-200 bg-amber-50'
    : 'border-green-200 bg-green-50';

  return (
    <Link to="/system/job-queues" className="no-underline block mb-4">
      <div className={`border rounded-xl px-5 py-3 flex items-center gap-6 ${color}`}>
        <div className="text-[13px] font-semibold text-slate-700">Queue Health</div>
        <div className="flex gap-4 text-[12px]">
          <span className="text-slate-500">Pending: <span className="font-semibold text-slate-700">{data.pending}</span></span>
          <span className={data.dlq > 0 ? 'text-amber-600' : 'text-slate-500'}>DLQ: <span className="font-semibold">{data.dlq}</span></span>
          <span className={data.failed > 10 ? 'text-red-600' : 'text-slate-500'}>Failed (24h): <span className="font-semibold">{data.failed}</span></span>
        </div>
      </div>
    </Link>
  );
}
