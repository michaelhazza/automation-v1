import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import MetricCard from '../components/MetricCard';
import { PendingApprovalCard } from '../components/dashboard/PendingApprovalCard';
import WorkspaceFeatureCard from '../components/dashboard/WorkspaceFeatureCard';
import UnifiedActivityFeed from '../components/UnifiedActivityFeed';
import { resolvePulseDetailUrl } from '../lib/resolvePulseDetailUrl';
import {
  trackPendingCardOpened,
  trackPendingCardApproved,
  trackPendingCardRejected,
} from '../lib/telemetry';
import type { PulseItem, PulseAttentionResponse } from '../hooks/usePulseAttention';

interface Agent { id: string; name: string; status: string; }
interface ActivityStats {
  totalRuns: number; completedRuns: number; failedRuns: number;
  totalTokens: number; totalToolCalls: number;
  totalItemsCreated: number; totalItemsUpdated: number; totalDeliverables: number;
  avgDurationMs: number;
}
interface HealthSummary { totalClients: number; healthy: number; attention: number; atRisk: number; }

export default function DashboardPage({ user }: { user: User }) {
  const [agents, setAgents]               = useState<Agent[]>([]);
  const [stats, setStats]                 = useState<ActivityStats | null>(null);
  const [attention, setAttention]         = useState<PulseAttentionResponse | null>(null);
  const [healthSummary, setHealthSummary] = useState<HealthSummary | null>(null);
  const [loading, setLoading]             = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api.get('/api/agents'),
      api.get('/api/agent-activity/stats', { params: { sinceDays: 7 } }).catch((err) => { console.error('[Dashboard] Failed to fetch activity stats:', err); return { data: null }; }),
      api.get('/api/pulse/attention').catch((err) => { console.error('[Dashboard] Failed to fetch pulse attention:', err); return { data: null }; }),
      api.get('/api/clientpulse/health-summary').catch(() => { return { data: null }; }),
    ]).then(([a, s, p, h]) => {
      setAgents(a.data);
      setStats(s.data);
      setAttention(p.data);
      setHealthSummary(h.data);
    }).catch((err) => console.error('[Dashboard] Failed to load dashboard data:', err)).finally(() => setLoading(false));
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const activeAgents = agents.filter(a => a.status === 'active');

  const handleAct = (item: PulseItem, intent: 'approve' | 'reject' | 'open') => {
    const destination = item.resolvedUrl ?? resolvePulseDetailUrl(item.detailUrl, item.subaccountId || null);
    if (!destination) return;

    if (intent === 'open') {
      trackPendingCardOpened({ kind: item.kind, lane: item.lane, itemId: item.id, resolvedVia: item.resolvedUrl ? 'backend' : 'fallback' });
      navigate(destination, { state: { sourceItemId: item.id } });
      return;
    }

    const tele = intent === 'approve' ? trackPendingCardApproved : trackPendingCardRejected;
    tele({ kind: item.kind, lane: item.lane, itemId: item.id });
    const url = `${destination}${destination.includes('?') ? '&' : '?'}intent=${intent}`;
    navigate(url, { state: { sourceItemId: item.id } });
  };

  const shimmer = 'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded-md';

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <div className={`h-9 w-64 ${shimmer}`} />
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
          {[1,2,3,4].map(i => <div key={i} className={`h-[88px] rounded-xl ${shimmer}`} />)}
        </div>
        <div className={`h-32 rounded-xl ${shimmer}`} />
        <div className={`h-52 rounded-xl ${shimmer}`} />
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
          label="Pending Approval"
          value={attention?.counts.total ?? 0}
          sub={attention ? (attention.counts.total === 0 ? 'all clear' : `${attention.counts.client} client · ${attention.counts.major} config · ${attention.counts.internal} internal`) : undefined}
          to="#pending"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          }
          iconBg="bg-rose-50" iconColor="text-rose-500"
          loading={loading}
        />

        <MetricCard
          label="Clients Needing Attention"
          value={healthSummary ? (healthSummary.attention + healthSummary.atRisk) : '—'}
          sub={healthSummary ? `of ${healthSummary.totalClients} clients` : undefined}
          to="/clientpulse"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          }
          iconBg="bg-amber-50" iconColor="text-amber-500"
          loading={loading}
        />

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
          sub={stats?.failedRuns ? `${stats.failedRuns} failed` : 'all good'}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          }
          iconBg="bg-emerald-50" iconColor="text-emerald-500"
        />
      </div>

      {/* ── System admin: Queue health summary ───────────────────────────── */}
      {user.role === 'system_admin' && (
        <QueueHealthSummary />
      )}

      {/* ── Pending approval ──────────────────────────────────────────────── */}
      {attention && attention.counts.total > 0 && (
        <div className="mb-8">
          <h2 id="pending" className="text-[17px] font-bold text-slate-900 tracking-tight mb-3.5">
            Pending your approval
          </h2>
          <div className="flex flex-col gap-3">
            {[...attention.lanes.client, ...attention.lanes.major, ...attention.lanes.internal].map(item => (
              <PendingApprovalCard
                key={item.id}
                item={item}
                resolveDetailUrl={resolvePulseDetailUrl}
                onAct={handleAct}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Your workspaces ───────────────────────────────────────────────── */}
      <div className="mb-8">
        <h2 className="text-[17px] font-bold text-slate-900 tracking-tight mb-3.5">Your workspaces</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <WorkspaceFeatureCard
            title="ClientPulse"
            href="/clientpulse"
            testId="workspace-card-clientpulse"
            summary={
              healthSummary ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex h-1.5 rounded-full overflow-hidden gap-0.5">
                    {healthSummary.totalClients > 0 ? (
                      <>
                        {healthSummary.healthy > 0 && (
                          <div className="bg-emerald-400 rounded-full" style={{ width: `${(healthSummary.healthy / healthSummary.totalClients) * 100}%` }} />
                        )}
                        {healthSummary.attention > 0 && (
                          <div className="bg-amber-400 rounded-full" style={{ width: `${(healthSummary.attention / healthSummary.totalClients) * 100}%` }} />
                        )}
                        {healthSummary.atRisk > 0 && (
                          <div className="bg-rose-500 rounded-full" style={{ width: `${(healthSummary.atRisk / healthSummary.totalClients) * 100}%` }} />
                        )}
                      </>
                    ) : (
                      <div className="bg-slate-200 rounded-full w-full" />
                    )}
                  </div>
                  <span className="text-[13px] text-slate-500">
                    {healthSummary.healthy} healthy · {healthSummary.attention} need attention · {healthSummary.atRisk} at risk
                  </span>
                </div>
              ) : (
                <span className="text-[13px] text-slate-400">Health monitoring</span>
              )
            }
          />
          <WorkspaceFeatureCard
            title="Settings"
            href="/clientpulse/settings"
            testId="workspace-card-settings"
            summary={<span className="text-[13px] text-slate-400">Team, integrations &amp; billing</span>}
          />
        </div>
      </div>

      {/* ── Recent activity ───────────────────────────────────────────────── */}
      <div className="mb-8">
        <h2 className="text-[17px] font-bold text-slate-900 tracking-tight mb-3.5">Recent activity</h2>
        <UnifiedActivityFeed orgId={user.organisationId} limit={20} />
      </div>
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
