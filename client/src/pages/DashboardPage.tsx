import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket, useSocketRoom, useSocketConnected } from '../hooks/useSocket';
import api from '../lib/api';
import { User } from '../lib/auth';
import MetricCard from '../components/MetricCard';
import { PendingApprovalCard } from '../components/dashboard/PendingApprovalCard';
import WorkspaceFeatureCard from '../components/dashboard/WorkspaceFeatureCard';
import { QueueHealthSummary } from '../components/dashboard/QueueHealthSummary';
import { FreshnessIndicator } from '../components/dashboard/FreshnessIndicator';
import { OperationalMetricsPlaceholder } from '../components/dashboard/OperationalMetricsPlaceholder';
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

interface TimestampedResponse<T> {
  data: T;
  serverTimestamp: string;
}

const RECONNECT_DEBOUNCE_MS = 500;

export default function DashboardPage({ user }: { user: User }) {
  const [agents, setAgents]               = useState<Agent[]>([]);
  const [stats, setStats]                 = useState<ActivityStats | null>(null);
  const [attention, setAttention]         = useState<PulseAttentionResponse | null>(null);
  const [healthSummary, setHealthSummary] = useState<HealthSummary | null>(null);
  const [loading, setLoading]             = useState(true);
  const navigate = useNavigate();

  // ── Per-group timestamp refs (latest-data-wins) ──────────────────────────
  const approvalsTs     = useRef<string>('');
  const activityTs      = useRef<string>('');
  const clientHealthTs  = useRef<string>('');
  const queueTs         = useRef<string>('');

  // ── Per-group inflight + pending (coalescing) ─────────────────────────────
  const approvalsInflight    = useRef(false);
  const approvalsPending     = useRef(false);
  const activityInflight     = useRef(false);
  const activityPending      = useRef(false);
  const clientHealthInflight = useRef(false);
  const clientHealthPending  = useRef(false);
  const queueInflight        = useRef(false);
  const queuePending         = useRef(false);

  // ── FreshnessIndicator ────────────────────────────────────────────────────
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date>(() => new Date());
  const lastUpdatedAtRef = useRef<Date>(new Date());

  // ── Refresh tokens (signal child components to re-fetch) ─────────────────
  const [activityRefreshToken, setActivityRefreshToken] = useState(0);
  const [queueRefreshToken, setQueueRefreshToken]       = useState(0);

  // ── Reconnect state ───────────────────────────────────────────────────────
  const prevConnected      = useRef<boolean | null>(null);
  const reconnectDebounce  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function applyIfNewer(
    currentTs: { current: string },
    incomingTs: string,
    apply: () => void,
  ): void {
    if (incomingTs > currentTs.current) {
      currentTs.current = incomingTs;
      apply();
    }
  }

  const markFresh = useCallback((ts: Date) => {
    if (ts > lastUpdatedAtRef.current) {
      lastUpdatedAtRef.current = ts;
      setLastUpdatedAt(ts);
    }
  }, []);

  // ── Refetch functions ─────────────────────────────────────────────────────

  async function refetchApprovals() {
    if (approvalsInflight.current) {
      approvalsPending.current = true;
      return;
    }
    approvalsInflight.current = true;
    try {
      const res = await api.get<TimestampedResponse<PulseAttentionResponse>>('/api/pulse/attention');
      applyIfNewer(approvalsTs, res.data.serverTimestamp, () => {
        setAttention(res.data.data);
        markFresh(new Date());
      });
    } catch (err) {
      console.error('[DashboardPage] refetchApprovals failed:', err);
    } finally {
      approvalsInflight.current = false;
      if (approvalsPending.current) {
        approvalsPending.current = false;
        void refetchApprovals();
      }
    }
  }

  async function refetchActivity() {
    if (activityInflight.current) {
      activityPending.current = true;
      return;
    }
    activityInflight.current = true;
    try {
      const [feedRes, statsRes] = await Promise.all([
        api.get<TimestampedResponse<{ items: unknown[]; total: number }>>('/api/activity', { params: { limit: 20, sort: 'newest' } }),
        api.get<TimestampedResponse<ActivityStats>>('/api/agent-activity/stats', { params: { sinceDays: 7 } }),
      ]);
      // Use min of two timestamps — both must be at least this fresh.
      const groupTs = feedRes.data.serverTimestamp < statsRes.data.serverTimestamp
        ? feedRes.data.serverTimestamp
        : statsRes.data.serverTimestamp;
      applyIfNewer(activityTs, groupTs, () => {
        setStats(statsRes.data.data);
        setActivityRefreshToken(t => t + 1);
        markFresh(new Date());
      });
    } catch (err) {
      console.error('[DashboardPage] refetchActivity failed:', err);
    } finally {
      activityInflight.current = false;
      if (activityPending.current) {
        activityPending.current = false;
        void refetchActivity();
      }
    }
  }

  async function refetchClientHealth() {
    if (clientHealthInflight.current) {
      clientHealthPending.current = true;
      return;
    }
    clientHealthInflight.current = true;
    try {
      const res = await api.get<TimestampedResponse<HealthSummary | null>>('/api/clientpulse/health-summary');
      applyIfNewer(clientHealthTs, res.data.serverTimestamp, () => {
        setHealthSummary(res.data.data);
        markFresh(new Date());
      });
    } catch (err) {
      console.error('[DashboardPage] refetchClientHealth failed:', err);
    } finally {
      clientHealthInflight.current = false;
      if (clientHealthPending.current) {
        clientHealthPending.current = false;
        void refetchClientHealth();
      }
    }
  }

  function refetchQueue() {
    setQueueRefreshToken(t => t + 1);
  }

  function refetchAll() {
    void refetchApprovals();
    void refetchActivity();
    void refetchClientHealth();
    if (user.role === 'system_admin') refetchQueue();
  }

  // ── Socket subscriptions (org room — auto-joined on connect) ─────────────

  // Spec §4.2 drift guardrail: every entry in the §4.2 wire-event-to-block
  // table maps to a refetch function here, and each useSocket call below
  // reads from this constant by literal key — TypeScript blocks renames or
  // removals because the keyed access becomes a compile error.
  const EVENT_TO_GROUP = {
    'dashboard.approval.changed':      refetchApprovals,
    'dashboard.activity.updated':      refetchActivity,
    'dashboard.client.health.changed': refetchClientHealth,
  } as const;

  useSocket('dashboard.approval.changed',      useCallback(() => { void EVENT_TO_GROUP['dashboard.approval.changed'](); }, []));
  useSocket('dashboard.activity.updated',      useCallback(() => { void EVENT_TO_GROUP['dashboard.activity.updated'](); }, []));
  useSocket('dashboard.client.health.changed', useCallback(() => { void EVENT_TO_GROUP['dashboard.client.health.changed'](); }, []));

  useSocketRoom(
    'sysadmin',
    user.role === 'system_admin' ? 'system' : null,
    {
      'dashboard.queue.changed': () => refetchQueue(),
    },
    () => { if (user.role === 'system_admin') refetchQueue(); },
  );

  const connected = useSocketConnected();

  useEffect(() => {
    const wasConnected = prevConnected.current;
    prevConnected.current = connected;

    // Only act on the false→true transition (reconnect), not initial mount (null→true).
    if (wasConnected === false && connected === true) {
      if (reconnectDebounce.current) clearTimeout(reconnectDebounce.current);
      reconnectDebounce.current = setTimeout(() => {
        refetchAll();
      }, RECONNECT_DEBOUNCE_MS);
    }

    return () => {
      if (reconnectDebounce.current) {
        clearTimeout(reconnectDebounce.current);
        reconnectDebounce.current = null;
      }
    };
  }, [connected]);

  useEffect(() => {
    Promise.all([
      api.get('/api/agents').catch((err) => { console.error('[Dashboard] Failed to fetch agents:', err); return { data: [] }; }),
      api.get('/api/agent-activity/stats', { params: { sinceDays: 7 } }).catch((err) => { console.error('[Dashboard] Failed to fetch activity stats:', err); return { data: { data: null, serverTimestamp: '' } }; }),
      api.get('/api/pulse/attention').catch((err) => { console.error('[Dashboard] Failed to fetch pulse attention:', err); return { data: { data: null, serverTimestamp: '' } }; }),
      api.get('/api/clientpulse/health-summary').catch(() => { return { data: { data: null, serverTimestamp: '' } }; }),
    ]).then(([a, s, p, h]) => {
      setAgents(a.data);
      // Route initial-load setters through applyIfNewer so a socket-driven
      // refetch that resolved during the load window cannot be silently
      // overwritten by an older initial-load response (latest-data-wins,
      // spec §6.2). Empty-string timestamps from the catch-fallbacks are
      // treated as not-newer and discarded by applyIfNewer's strict `>`.
      applyIfNewer(activityTs, s.data.serverTimestamp ?? '', () => {
        setStats(s.data.data);
      });
      applyIfNewer(approvalsTs, p.data.serverTimestamp ?? '', () => {
        setAttention(p.data.data);
      });
      applyIfNewer(clientHealthTs, h.data.serverTimestamp ?? '', () => {
        setHealthSummary(h.data.data);
      });
      markFresh(new Date());
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
        <FreshnessIndicator lastUpdatedAt={lastUpdatedAt} />
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
        <QueueHealthSummary refreshToken={queueRefreshToken} />
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

      {/* [LAYOUT-RESERVED: Piece 3 — Operational metrics] */}
      <OperationalMetricsPlaceholder />

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
                  <div className="flex h-1.5 rounded-full overflow-hidden">
                    {(() => {
                      const knownTotal = healthSummary.healthy + healthSummary.attention + healthSummary.atRisk;
                      const barBase = knownTotal > 0 ? knownTotal : 1;
                      return knownTotal > 0 ? (
                        <>
                          {healthSummary.healthy > 0 && (
                            <div className="bg-emerald-400" style={{ width: `${(healthSummary.healthy / barBase) * 100}%` }} />
                          )}
                          {healthSummary.attention > 0 && (
                            <div className="bg-amber-400" style={{ width: `${(healthSummary.attention / barBase) * 100}%` }} />
                          )}
                          {healthSummary.atRisk > 0 && (
                            <div className="bg-rose-500" style={{ width: `${(healthSummary.atRisk / barBase) * 100}%` }} />
                          )}
                        </>
                      ) : (
                        <div className="bg-slate-200 w-full" />
                      );
                    })()}
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
        <UnifiedActivityFeed
          orgId={user.organisationId}
          limit={20}
          refreshToken={activityRefreshToken}
          expectedTimestamp={activityTs.current}
        />
      </div>
    </div>
  );
}
