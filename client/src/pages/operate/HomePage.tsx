// client/src/pages/operate/HomePage.tsx
//
// C7 — Home page: KPI tiles, Runs chart, Recent activity widget.
// Replaces DashboardPage.tsx (deleted in C8).
//
// === DashboardPage widgets kept vs cut ===
// KEPT:
//   - Greeting header (user's first name + active-agent count)
//   - KPI tiles: Pending Approval, Clients Needing Attention, Active Agents, Runs (7 days)
//   - KPI tile: Cost MTD (org_admin only — spec §6)
//   - Runs-over-time chart (RunActivityChart from ActivityCharts)
//   - Recent activity section (via ActivityRow + fetchActivity)
// CUT:
//   - QueueHealthSummary (system_admin debug panel — not in spec §1 for Operate Home)
//   - PendingApprovalCard list section (approval workflow — Inbox scope, not Home)
//   - OperationalMetricsPlaceholder (dev placeholder, not spec §1)
//   - AgentRecommendationsList (advisory feature — deferred per frontend-design principles)
//   - WorkspaceFeatureCard ("Your workspaces") — nav chrome, not a Home widget
//   - FreshnessIndicator (internal dev tool, cuts clutter for non-technical operators)
//   - DashboardErrorBanner (consolidated; tile-level inline errors replace the banner)
//   - Socket-driven live refetch (not needed for Home; tiles refetch independently on mount)
//
// === Locked invariant (plan C7) ===
// Each KPI tile owns its own loading/error/data state and fetches independently.
// A failure in one tile MUST NOT blank or fail the others.
// Tiles do NOT share a parent useQuery or a single Promise.all.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { User } from '../../lib/auth';
import api, { fetchActivity } from '../../lib/api';
import type { ActivityItem } from '../../../../shared/types/operate';
import { PageShell } from '../../components/PageShell';
import MetricCard from '../../components/MetricCard';
import { RunActivityChart } from '../../components/ActivityCharts';
import { ActivityRow } from './components/ActivityRow';
import { ActivityDetailModal } from './components/ActivityDetailModal';
import { HomeActiveAgentsWidget } from '../../components/home/HomeActiveAgentsWidget';
import { useUserOwnedAgents } from '../../hooks/useUserOwnedAgents';
import { useHomeWidgets } from '../../hooks/useHomeWidgets';
import PersonalZoneCard from '../../components/personal/PersonalZoneCard';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface ActivityStats {
  totalRuns: number;
  failedRuns: number;
}

interface AttentionCounts {
  total: number;
  client: number;
  major: number;
  internal: number;
}

interface HealthSummary {
  totalClients: number;
  attention: number;
  atRisk: number;
}

interface Agent {
  id: string;
  status: string;
}

interface DayBucket {
  date: string;
  completed: number;
  failed: number;
  timeout: number;
  other: number;
  total: number;
}

// Tile state shape — each tile owns one of these independently.
interface TileState<T> {
  loading: boolean;
  error: boolean;
  data: T | null;
}

function useTileState<T>(): [TileState<T>, (promise: Promise<T>) => void] {
  const [state, setState] = useState<TileState<T>>({ loading: true, error: false, data: null });

  function load(promise: Promise<T>) {
    setState({ loading: true, error: false, data: null });
    promise
      .then((data) => setState({ loading: false, error: false, data }))
      .catch(() => setState({ loading: false, error: true, data: null }));
  }

  return [state, load];
}

// ---------------------------------------------------------------------------
// Skeleton shimmer
// ---------------------------------------------------------------------------

const SHIMMER_CLS =
  'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded-md';

function Skeleton({ className }: { className?: string }) {
  return <div className={`${SHIMMER_CLS} ${className ?? ''}`} />;
}

// ---------------------------------------------------------------------------
// Inline error chip — shown inside a tile when its own fetch failed
// ---------------------------------------------------------------------------

function ErrorChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600">
      <span aria-hidden="true">!</span>
      Error
    </span>
  );
}

// ---------------------------------------------------------------------------
// KPI icons
// ---------------------------------------------------------------------------

const IconBell = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
  </svg>
);

const IconUsers = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);

const IconAgent = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a5 5 0 1 0 0 10A5 5 0 0 0 12 2z"/>
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
    <circle cx="18" cy="8" r="3"/>
    <path d="M21 6l-1 1-1-1"/>
  </svg>
);

const IconPlay = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>
);

const IconDollar = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23"/>
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
  </svg>
);

// ---------------------------------------------------------------------------
// Cost formatting helper
// ---------------------------------------------------------------------------

function fmtCostCents(cents: number): string {
  if (cents < 100) return `$${(cents / 100).toFixed(2)}`;
  if (cents < 100_000) return `$${(cents / 100).toFixed(0)}`;
  return `$${(cents / 10_000).toFixed(0)}k`;
}

// ---------------------------------------------------------------------------
// Personal zone
// ---------------------------------------------------------------------------

function PersonalZone() {
  const { data: ownedAgents, isLoading: agentsLoading } = useUserOwnedAgents();
  const { data: widgets, isLoading: widgetsLoading } = useHomeWidgets();

  const isLoading = agentsLoading || widgetsLoading;

  if (isLoading) {
    return (
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3 px-1">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-widest">Personal</span>
        </div>
        <div className={SHIMMER_CLS + ' h-28 w-full max-w-sm rounded-xl'} />
      </div>
    );
  }

  if (ownedAgents.length === 0) {
    return (
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3 px-1">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-widest">Personal</span>
        </div>
        <div className="bg-gradient-to-br from-white to-slate-50 border border-indigo-100 rounded-xl p-5 flex items-center gap-4 max-w-sm">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
            A
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-900">Set up your Personal Assistant</div>
            <div className="text-xs text-slate-500 mt-0.5">Drafts, calendar, briefings and more.</div>
          </div>
          <Link
            to="/personal/setup"
            className="flex-shrink-0 px-3 py-1.5 bg-indigo-700 text-white rounded-lg text-xs font-semibold hover:bg-indigo-800 transition-colors"
          >
            Set up
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
        <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-widest">Personal</span>
      </div>
      <div className="flex gap-3 flex-wrap">
        {ownedAgents.map((agent) => {
          const widget = widgets.find((w) => w.agentId === agent.id) ?? null;
          if (!widget) {
            return (
              <div
                key={agent.id}
                className="bg-gradient-to-br from-white to-slate-50 border border-indigo-200 rounded-xl p-5 shadow-sm min-w-[280px] flex flex-col gap-3"
              >
                <div className="flex items-center gap-3 pb-3 border-b border-indigo-50">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                    {agent.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-slate-900 truncate">{agent.name}</div>
                    <div className="text-xs text-slate-500">Personal agent</div>
                  </div>
                  <Link
                    to={`/personal/${agent.id}`}
                    className="text-xs font-semibold text-indigo-600 bg-white border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50 transition-colors flex-shrink-0"
                  >
                    Open
                  </Link>
                </div>
                <p className="text-sm text-slate-400 italic">No data yet</p>
              </div>
            );
          }
          return <PersonalZoneCard key={agent.id} widget={widget} />;
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HomePage
// ---------------------------------------------------------------------------

export default function HomePage({ user }: { user: User }) {
  const isOrgAdmin = user.role === 'org_admin' || user.role === 'system_admin';

  // ── Per-tile isolated state ───────────────────────────────────────────────
  const [attentionState, loadAttention] = useTileState<AttentionCounts>();
  const [healthState, loadHealth]       = useTileState<HealthSummary>();
  const [agentsState, loadAgents]       = useTileState<Agent[]>();
  const [statsState, loadStats]         = useTileState<ActivityStats>();
  // Cost MTD — only fetched for org_admin / system_admin (spec §6)
  const [costState, loadCost]           = useTileState<{ totalCostCents: number }>();
  // Org subaccount ID — for the HomeActiveAgentsWidget presence stream
  const [orgSubaccountId, setOrgSubaccountId] = useState<string | null>(null);

  // ── Chart section isolated state ──────────────────────────────────────────
  const [chartLoading, setChartLoading]   = useState(true);
  const [chartError, setChartError]       = useState(false);
  const [chartData, setChartData]         = useState<DayBucket[] | null>(null);

  // ── Recent activity section isolated state ────────────────────────────────
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError]     = useState(false);
  const [activityItems, setActivityItems]     = useState<ActivityItem[]>([]);

  // ── Modal state ───────────────────────────────────────────────────────────
  const [selectedItem, setSelectedItem] = useState<ActivityItem | null>(null);

  // ── Mount: fire all fetches independently ─────────────────────────────────
  useEffect(() => {
    // Workspace subaccount ID — single canonical fetch from the user profile,
    // sourced from `orgSubaccountService.getOrgSubaccount` server-side. Avoids
    // re-fetching all subaccounts and filtering ad-hoc by `isOrgSubaccount`.
    api.get<{ workspaceSubaccountId: string | null }>('/api/users/me')
      .then((r) => {
        if (r.data?.workspaceSubaccountId) setOrgSubaccountId(r.data.workspaceSubaccountId);
      })
      .catch(() => { /* non-fatal — widget stays hidden */ });

    // Pending approvals / attention counts
    loadAttention(
      api.get<{ data: { counts: AttentionCounts } }>('/api/pulse/attention')
        .then((r) => r.data.data.counts),
    );

    // Client health summary
    loadHealth(
      api.get<{ data: HealthSummary | null }>('/api/clientpulse/health-summary')
        .then((r) => {
          if (!r.data.data) throw new Error('no health data');
          return r.data.data;
        }),
    );

    // Active agents list
    loadAgents(
      api.get<{ id: string; status: string }[]>('/api/agents')
        .then((r) => r.data),
    );

    // Activity stats (7-day run counts)
    loadStats(
      api.get<{ data: ActivityStats }>('/api/agent-activity/stats', { params: { sinceDays: 7 } })
        .then((r) => r.data.data),
    );

    // Cost MTD — only for org_admin / system_admin (spec §6)
    if (isOrgAdmin) {
      const billingMonth = new Date().toISOString().slice(0, 7);
      loadCost(
        api.get<{ monthly: { totalCostCents: number } | null }>(
          `/api/orgs/${user.organisationId}/usage/summary`,
          { params: { month: billingMonth } },
        ).then((r) => ({
          totalCostCents: r.data.monthly?.totalCostCents ?? 0,
        })),
      );
    }

    // Runs chart — 14-day daily breakdown (same endpoint as AdminAgentEditPage)
    api.get<DayBucket[]>('/api/agent-activity/daily', { params: { sinceDays: 14 } })
      .then((r) => {
        setChartData(r.data);
        setChartLoading(false);
      })
      .catch(() => {
        setChartError(true);
        setChartLoading(false);
      });

    // Recent activity (10 newest items)
    fetchActivity({ limit: 10, sort: 'newest' })
      .then((result) => {
        setActivityItems(result.items);
        setActivityLoading(false);
      })
      .catch(() => {
        setActivityError(true);
        setActivityLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const activeAgents = agentsState.data?.filter((a) => a.status === 'active') ?? [];
  const totalAgents  = agentsState.data?.length ?? 0;

  return (
    <PageShell>
      <div className="animate-[fadeIn_0.2s_ease-out_both]">

        {/* ── Greeting ──────────────────────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="text-[28px] font-extrabold text-slate-900 tracking-tight m-0">
            {greeting}, {user.firstName}
          </h1>
          <p className="text-sm text-slate-500 mt-1.5">
            {agentsState.loading
              ? 'Loading…'
              : activeAgents.length > 0
                ? `${activeAgents.length} AI agent${activeAgents.length === 1 ? '' : 's'} ready to work.`
                : "Let's get your AI team set up."}
          </p>
        </div>

        {/* ── Personal zone ─────────────────────────────────────────────── */}
        <PersonalZone />

        {/* ── KPI tiles — each owns its own state (locked invariant) ─────── */}
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))] mb-6">

          {/* Pending Approval */}
          <MetricCard
            label="Pending Approval"
            value={attentionState.loading ? '…' : attentionState.error ? '—' : (attentionState.data?.total ?? 0)}
            sub={
              attentionState.loading ? undefined
              : attentionState.error ? undefined
              : attentionState.data?.total === 0
                ? 'all clear'
                : `${attentionState.data?.client ?? 0} client · ${attentionState.data?.major ?? 0} config · ${attentionState.data?.internal ?? 0} internal`
            }
            to="/inbox"
            icon={IconBell}
            iconBg="bg-rose-50"
            iconColor="text-rose-500"
            loading={attentionState.loading}
          />

          {/* Clients Needing Attention */}
          <MetricCard
            label="Clients Needing Attention"
            value={healthState.loading ? '…' : healthState.error ? '—' : ((healthState.data?.attention ?? 0) + (healthState.data?.atRisk ?? 0))}
            sub={
              healthState.loading ? undefined
              : healthState.error ? undefined
              : healthState.data
                ? `of ${healthState.data.totalClients} clients`
                : undefined
            }
            to="/clientpulse"
            icon={IconUsers}
            iconBg="bg-amber-50"
            iconColor="text-amber-500"
            loading={healthState.loading}
          />

          {/* Active Agents — live presence widget (Chunk 9) */}
          {orgSubaccountId ? (
            <HomeActiveAgentsWidget subaccountId={orgSubaccountId} />
          ) : (
            <MetricCard
              label="Active Agents"
              value={agentsState.loading ? '…' : agentsState.error ? '—' : activeAgents.length}
              sub={
                agentsState.loading ? undefined
                : agentsState.error ? undefined
                : totalAgents > activeAgents.length
                  ? `${totalAgents - activeAgents.length} inactive`
                  : 'all ready'
              }
              to="/agents"
              icon={IconAgent}
              iconBg="bg-indigo-50"
              iconColor="text-indigo-500"
              loading={agentsState.loading}
            />
          )}

          {/* Runs 7 days */}
          <MetricCard
            label="Runs (7 days)"
            value={statsState.loading ? '…' : statsState.error ? '—' : (statsState.data?.totalRuns ?? 0)}
            sub={
              statsState.loading ? undefined
              : statsState.error ? undefined
              : statsState.data?.failedRuns
                ? `${statsState.data.failedRuns} failed`
                : 'all good'
            }
            icon={IconPlay}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-500"
            loading={statsState.loading}
          />

          {/* Cost MTD — gated to org_admin / system_admin (spec §6) */}
          {isOrgAdmin && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-violet-50 text-violet-500">
                  {IconDollar}
                </div>
                <div className="text-right">
                  {costState.loading ? (
                    <Skeleton className="h-7 w-20" />
                  ) : costState.error ? (
                    <ErrorChip />
                  ) : (
                    <div className="text-[22px] font-extrabold text-slate-900 leading-none">
                      {fmtCostCents(costState.data?.totalCostCents ?? 0)}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">
                  Cost MTD
                </div>
                {!costState.loading && !costState.error && (
                  <div className="text-[12px] text-slate-400 mt-0.5">this month</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Runs chart — isolated section ─────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <h2 className="text-[15px] font-bold text-slate-900 tracking-tight mb-4">
            Runs over time (14 days)
          </h2>
          {chartLoading ? (
            <Skeleton className="h-[140px] w-full" />
          ) : chartError ? (
            <div className="flex items-center justify-center h-[140px] text-sm text-slate-400">
              Failed to load chart data
            </div>
          ) : (
            <RunActivityChart data={chartData ?? []} />
          )}
        </div>

        {/* ── Recent activity — isolated section ────────────────────────── */}
        <div className="mb-8">
          <h2 className="text-[17px] font-bold text-slate-900 tracking-tight mb-3.5">
            Recent activity
          </h2>

          {activityLoading ? (
            <div className="flex flex-col gap-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : activityError ? (
            <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">
              Failed to load recent activity.
            </div>
          ) : activityItems.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">
              No recent activity.
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left">
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Subject</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Severity</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actor</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Workspace</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Trigger</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">When</th>
                  </tr>
                </thead>
                <tbody>
                  {activityItems.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors"
                    >
                      {/* ActivityRow renders td cells — embedded=true so run-id is plain text */}
                      <ActivityRow
                        item={item}
                        onOpen={(i) => setSelectedItem(i)}
                        embedded={true}
                      />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Activity detail modal (spec §4.4 — modal, NOT drawer) ──────── */}
        {selectedItem && (
          <ActivityDetailModal
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
          />
        )}
      </div>
    </PageShell>
  );
}
