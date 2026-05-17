// client/src/pages/operate/HomePage.tsx
//
// Home page: Greeting, Personal Zone, Runs chart, Recent activity.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { User } from '../../lib/auth';
import api, { fetchActivity } from '../../lib/api';
import type { ActivityItem } from '../../../../shared/types/operate';
import { PageShell } from '../../components/PageShell';
import { RunActivityChart } from '../../components/ActivityCharts';
import { ActivityRow } from './components/ActivityRow';
import { ActivityDetailModal } from './components/ActivityDetailModal';
import { useUserOwnedAgents } from '../../hooks/useUserOwnedAgents';
import { useHomeWidgets } from '../../hooks/useHomeWidgets';
import PersonalZoneCard from '../../components/personal/PersonalZoneCard';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

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
  // ── Per-tile isolated state ───────────────────────────────────────────────
  const [agentsState, loadAgents]       = useTileState<Agent[]>();

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
    // Active agents list
    loadAgents(
      api.get<{ id: string; status: string }[]>('/api/agents')
        .then((r) => r.data),
    );

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
