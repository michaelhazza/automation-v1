/**
 * PortalPage — subaccount member's process browser + portal playbook cards (§9.4).
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import HelpHint from '../components/ui/HelpHint';
import UpcomingWorkCard from '../components/portal/UpcomingWorkCard';
import { toast } from 'sonner';

interface PortalProcess {
  id: string;
  name: string;
  description: string | null;
  inputSchema: string | null;
  outputSchema: string | null;
  category: { id: string; name: string; colour: string | null } | null;
  source: 'linked' | 'native';
}

interface Category { id: string; name: string; colour: string | null; }
interface SubaccountInfo { id: string; name: string; }

// §9.4 portal run card types
interface PortalPresentation {
  cardTitle?: string;
  headlineStepId?: string;
  headlineOutputPath?: string;
  detailRoute?: string;
}
interface PortalRun {
  id: string;
  workflowSlug: string | null;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  portalPresentation: PortalPresentation | null;
}

const ACTIVE_STATUSES = new Set(['pending', 'running', 'awaiting_input', 'awaiting_approval']);

// §G10.4 — Daily Brief hero card aggregate
interface DailyBriefCard {
  active: boolean;
  latestRun: { id: string; completedAt: string | null } | null;
  nextRunAt: string | null;
  scheduledTaskId: string | null;
}

export default function PortalPage({ user: _user }: { user: User }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [subaccount, setSubaccount] = useState<SubaccountInfo | null>(null);
  const [processes, setProcesses] = useState<PortalProcess[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [portalRuns, setPortalRuns] = useState<PortalRun[]>([]);
  const [dailyBriefCard, setDailyBriefCard] = useState<DailyBriefCard | null>(null);
  // Feature 1 (docs/routines-response-dev-spec.md §3.5) — portal-card access
  // is gated on `subaccount.schedule.view_calendar`. `client_user` carries it
  // by default so the card shows up without needing the broader workspace.view.
  const [canViewCalendar, setCanViewCalendar] = useState(false);
  const [runningNow, setRunningNow] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!subaccountId) return;
    Promise.all([
      api.get(`/api/portal/${subaccountId}/processes`),
      api.get(`/api/portal/${subaccountId}/playbook-runs`).catch(() => ({ data: { runs: [] } })),
      // §G10.4 — gated on completed-run + active-schedule server-side, so
      // the client just reads `active` without running its own joins.
      api
        .get<DailyBriefCard>(`/api/portal/${subaccountId}/intelligence-briefing-card`)
        .catch(() => ({ data: null as DailyBriefCard | null })),
      api
        .get<{ permissions: string[] }>(`/api/subaccounts/${subaccountId}/my-permissions`)
        .catch(() => ({ data: { permissions: [] as string[] } })),
    ])
      .then(([processRes, runsRes, briefRes, permsRes]) => {
        setSubaccount(processRes.data.subaccount);
        setProcesses(processRes.data.processes ?? []);
        setCategories(processRes.data.categories ?? []);
        setPortalRuns(runsRes.data.runs ?? []);
        setDailyBriefCard(briefRes.data ?? null);
        setCanViewCalendar(
          (permsRes.data?.permissions ?? []).includes('subaccount.schedule.view_calendar')
        );
      })
      .catch((err) => {
        const e = err as { response?: { data?: { error?: string } } };
        setError(e.response?.data?.error ?? 'Failed to load processes');
      })
      .finally(() => setLoading(false));
  }, [subaccountId]);

  const handleRunNow = async (run: PortalRun) => {
    if (!subaccountId) return;
    const alreadyActive = ACTIVE_STATUSES.has(run.status);
    if (alreadyActive) return;
    setRunningNow((prev) => new Set([...prev, run.id]));
    try {
      const { data } = await api.post<{ runId: string }>(
        `/api/portal/${subaccountId}/playbook-runs/${run.id}/run-now`,
      );
      toast.success('Run started');
      // Navigate to the new run
      window.location.href = `/portal/${subaccountId}/runs/${data.runId}`;
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to start run');
      setRunningNow((prev) => { const next = new Set(prev); next.delete(run.id); return next; });
    }
  };

  const filtered = processes.filter((t) => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || (t.description ?? '').toLowerCase().includes(search.toLowerCase());
    const matchCat = !selectedCategory || t.category?.id === selectedCategory;
    return matchSearch && matchCat;
  });

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  if (error) return <div className="text-red-600 p-8">{error}</div>;

  return (
    <>
      <h1 className="text-[28px] font-bold text-slate-800 mb-1">{subaccount?.name ?? 'Portal'}</h1>
      <p className="text-slate-500 mb-7">Select a process to run an automation.</p>

      {/* §G10.4 — Daily Brief hero card. Shown only when the subaccount
          has a completed DIB run AND an active scheduled task producing
          briefs. Server enforces both gates; the card stays hidden
          otherwise so a stale/paused schedule never advertises a broken
          card. */}
      {dailyBriefCard?.active && dailyBriefCard.latestRun && (
        <div className="mb-8 rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-500 text-white px-6 py-5 shadow-md">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider opacity-80">
                Intelligence Briefing
              </div>
              <div className="text-[20px] font-bold mt-0.5">This week's briefing is ready</div>
              <div className="text-[13px] opacity-90 mt-1">
                {dailyBriefCard.latestRun.completedAt
                  ? `Delivered ${new Date(dailyBriefCard.latestRun.completedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                  : 'Latest brief completed'}
                {dailyBriefCard.nextRunAt && (
                  <>
                    {' · '}Next run{' '}
                    {new Date(dailyBriefCard.nextRunAt).toLocaleString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </>
                )}
              </div>
            </div>
            <Link
              to={`/portal/${subaccountId}/runs/${dailyBriefCard.latestRun.id}`}
              className="px-4 py-2 bg-white text-indigo-700 text-[13px] font-semibold rounded-lg no-underline hover:bg-indigo-50 shrink-0"
            >
              Read latest brief →
            </Link>
          </div>
        </div>
      )}

      {/* Feature 1 — Upcoming Work card (docs/routines-response-dev-spec.md §3.5)
          Gated server-side by `subaccount.schedule.view_calendar`; we also skip
          rendering when the permission is absent to avoid a dangling frame. */}
      {canViewCalendar && subaccountId && (
        <div className="mb-8">
          <UpcomingWorkCard subaccountId={subaccountId} hasPermission={canViewCalendar} />
        </div>
      )}

      {/* §9.4 Portal playbook run cards — one per isPortalVisible run.
          When the Daily Brief hero card is active we omit its run from
          this list to avoid showing it twice. */}
      {(() => {
        const otherRuns = dailyBriefCard?.active
          ? portalRuns.filter((r) => r.workflowSlug !== 'intelligence-briefing')
          : portalRuns;
        if (otherRuns.length === 0) return null;
        return (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-[16px] font-semibold text-slate-800 m-0">Workflows</h2>
            <HelpHint text="These playbooks were run on behalf of your account. 'Run now' kicks off a fresh run immediately — your next scheduled run still happens on time." />
          </div>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {otherRuns.map((run) => {
              const pp = run.portalPresentation;
              const title = pp?.cardTitle ?? run.workflowSlug ?? 'Workflow run';
              const isActive = ACTIVE_STATUSES.has(run.status);
              const isRunningNow = runningNow.has(run.id);
              const lastRunDate = run.completedAt ?? run.startedAt ?? run.createdAt;
              return (
                <div
                  key={run.id}
                  className="bg-white rounded-xl border border-slate-200 px-5 py-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="font-semibold text-slate-800 text-[15px]">{title}</div>
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                        run.status === 'completed'
                          ? 'bg-emerald-50 text-emerald-700'
                          : run.status === 'failed' || run.status === 'cancelled'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-indigo-50 text-indigo-700'
                      }`}
                    >
                      {run.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="text-[12px] text-slate-500 mb-4">
                    {run.status === 'completed' || run.status === 'completed_with_errors'
                      ? `Completed ${new Date(lastRunDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                      : isActive
                        ? 'In progress…'
                        : `Last run ${new Date(lastRunDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                  </div>
                  <div className="flex gap-2">
                    <Link
                      to={pp?.detailRoute ?? `/portal/${subaccountId}/runs/${run.id}`}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-medium rounded-lg no-underline inline-block"
                    >
                      Open full brief →
                    </Link>
                    <button
                      type="button"
                      disabled={isActive || isRunningNow}
                      onClick={() => handleRunNow(run)}
                      title={isActive ? 'Already running' : 'Kick off immediately — scheduled runs are not affected'}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-lg transition-colors"
                    >
                      {isRunningNow ? 'Starting…' : 'Run now'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}

      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-[200px] shrink-0">
          <div className="mb-3">
            <input
              type="text"
              placeholder="Search processes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {categories.length > 0 && (
            <>
              <div className="font-semibold text-slate-700 text-[13px] mb-2">Categories</div>
              <div
                onClick={() => setSelectedCategory('')}
                className={`px-3 py-2 rounded-lg cursor-pointer text-[13px] mb-1 ${!selectedCategory ? 'bg-blue-100 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                All
              </div>
              {categories.map((cat) => (
                <div
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-3 py-2 rounded-lg cursor-pointer text-[13px] mb-1 flex items-center gap-2 ${selectedCategory === cat.id ? 'bg-blue-100 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  {cat.colour && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: cat.colour }} />}
                  {cat.name}
                </div>
              ))}
            </>
          )}
          <div className="mt-5 pt-4 border-t border-slate-200">
            <Link to={`/portal/${subaccountId}/executions`} className="block text-[13px] text-blue-600 no-underline hover:underline py-2">
              View my executions →
            </Link>
          </div>
        </div>

        {/* Process grid */}
        <div className="flex-1">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
              No processes found. {search && 'Try a different search term.'}
            </div>
          ) : (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
              {filtered.map((process) => (
                <Link key={process.id} to={`/portal/${subaccountId}/processes/${process.id}`} className="no-underline">
                  <div className="bg-white rounded-xl px-6 py-5 shadow-sm border border-slate-200 h-full hover:border-indigo-300 hover:shadow-md transition-all">
                    {process.category && (
                      <div className="flex items-center gap-1.5 mb-2">
                        {process.category.colour && <span className="w-2 h-2 rounded-full" style={{ background: process.category.colour }} />}
                        <span className="text-[11px] text-slate-500">{process.category.name}</span>
                      </div>
                    )}
                    <div className="font-semibold text-slate-800 mb-2 text-[16px]">{process.name}</div>
                    {process.description && <div className="text-[13px] text-slate-500 leading-relaxed mb-3">{process.description}</div>}
                    {process.inputSchema && (
                      <div className="text-[12px] text-sky-700 bg-sky-50 px-2.5 py-1.5 rounded-lg">
                        {process.inputSchema.substring(0, 80)}{process.inputSchema.length > 80 ? '...' : ''}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
