import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import { AGENT_RUN_STATUS, isTerminalRunStatus } from '../lib/runStatus';
import { useSocketRoom } from '../hooks/useSocket';
import TraceChainSidebar from '../components/TraceChainSidebar';
import TraceChainTimeline from '../components/TraceChainTimeline';
import ExecutionPlanPane from '../components/ExecutionPlanPane';
import RunTraceView, { type RunDetail } from '../components/runs/RunTraceView';
import DelegationGraphView from '../components/run-trace/DelegationGraphView';

/**
 * IEE Phase 0 — while a run is in the `delegated` state we poll the worker-
 * side progress endpoint for step count + heartbeat age, so the user sees
 * live progress instead of a silent "delegated" label. See
 * docs/iee-delegation-lifecycle-spec.md Step 6.
 */
interface IeeProgress {
  ieeRunId: string;
  status: string;
  stepCount: number;
  heartbeatAgeSeconds: number | null;
  startedAt: string | null;
  failureReason: string | null;
}

/**
 * Polling bounds (external review Blocker 5).
 *
 *  - Polling only runs while the tab is visible (document.visibilityState).
 *    Multiple tabs on the same run-detail page no longer all hammer the
 *    server in parallel when the user is not looking at them.
 *  - Max total poll duration caps the loop so a stuck 'delegated' parent
 *    that never transitions — e.g. the worker died AND the reconciliation
 *    cron also failed — stops polling after a finite time. The user can
 *    refresh the page to resume.
 *  - Exponential backoff: the interval grows along the schedule below
 *    when consecutive polls return no progress change. Reset to the
 *    base interval whenever the worker reports meaningful progress
 *    (stepCount advanced or status changed). Under active work the
 *    feel is snappy; when the worker is idle we stop hammering.
 */
const POLL_BACKOFF_SCHEDULE_MS = [3_000, 5_000, 10_000] as const;
const POLL_MAX_DURATION_MS = 15 * 60 * 1_000; // 15 minutes

export default function RunTraceViewerPage({ user: _user }: { user: User }) {
  const { subaccountId, runId: routeRunId } = useParams<{ subaccountId: string; runId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeRunId, setActiveRunId] = useState(routeRunId ?? '');
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chainRuns, setChainRuns] = useState<Array<{
    id: string; agentName: string; isSubAgent: boolean; runSource: string;
    status: string; startedAt: string | null; completedAt: string | null;
    durationMs: number | null; totalTokens: number | null;
  }>>([]);

  const [activeTab, setActiveTab] = useState<'trace' | 'delegation-graph'>(
    (location.state as { initialTab?: string } | null)?.initialTab === 'delegation-graph'
      ? 'delegation-graph'
      : 'trace',
  );

  useEffect(() => { if (routeRunId) setActiveRunId(routeRunId); }, [routeRunId]);

  const runId = activeRunId || routeRunId;

  // IEE Phase 0 — progress polling state for delegated runs.
  const [ieeProgress, setIeeProgress] = useState<IeeProgress | null>(null);

  const refreshRun = useCallback(async () => {
    if (!runId) return;
    try {
      const { data } = await api.get(`/api/agent-runs/${runId}`);
      setRun(data);
    } catch (err) {
      // Silent — the initial load handles the error state.
    }
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    api.get(`/api/agent-runs/${runId}`)
      .then(({ data }) => setRun(data))
      .catch((err) => setError(err.response?.data?.error ?? 'Failed to load run'))
      .finally(() => setLoading(false));
    api.get(`/api/agent-runs/${runId}/chain`)
      .then(({ data }) => setChainRuns(data.runs ?? []))
      .catch(() => setChainRuns([]));
  }, [runId]);

  // IEE Phase 0 — subscribe to WebSocket events so terminal transitions
  // from the worker-side event handler immediately refresh the run view.
  useSocketRoom(
    'agent-run',
    runId ?? null,
    {
      'agent:run:delegated': refreshRun,
      'agent:run:completed': refreshRun,
      'agent:run:failed': refreshRun,
    },
    refreshRun,
  );

  // IEE Phase 0 — while the run is delegated, poll the progress endpoint
  // for step count + heartbeat age. Stop polling the moment the parent
  // status leaves 'delegated' (either to a terminal state via the event
  // handler, or via the reconciliation cron).
  //
  // External review Blocker 4: ieeRunId is now a first-class field on the
  // /api/agent-runs/:id response, so we no longer regex-parse it from the
  // summary string. Falls back to null for non-IEE runs.
  const ieeRunId = run?.status === AGENT_RUN_STATUS.DELEGATED
    ? (run?.ieeRunId ?? null)
    : null;

  useEffect(() => {
    if (!ieeRunId) {
      setIeeProgress(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Track stepCount across polls so we can detect "no progress" and
    // back off. Reset the backoff index whenever the worker reports
    // forward progress (stepCount advanced OR status changed).
    let lastStepCount = -1;
    let lastStatus = '';
    let backoffIdx = 0;
    const startedAt = Date.now();
    const subaccountParam = subaccountId ? `?subaccountId=${subaccountId}` : '';

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const scheduleNext = () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return; // resumed by visibilitychange
      if (Date.now() - startedAt >= POLL_MAX_DURATION_MS) return;
      const delay = POLL_BACKOFF_SCHEDULE_MS[Math.min(backoffIdx, POLL_BACKOFF_SCHEDULE_MS.length - 1)];
      timer = setTimeout(fetchProgress, delay);
    };

    const fetchProgress = async () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return;
      try {
        const { data } = await api.get(`/api/iee/runs/${ieeRunId}/progress${subaccountParam}`);
        if (cancelled) return;
        setIeeProgress(data);
        // When the worker reports a terminal state, stop polling immediately
        // and kick a parent-run refresh. The useEffect below handles the
        // eventual-consistency gap (parent still 'delegated' for a moment).
        if (['completed', 'failed', 'cancelled'].includes(data?.status)) {
          cancelled = true;
          clearTimer();
          refreshRun();
          return;
        }
        const progressed = typeof data?.stepCount === 'number'
          && (data.stepCount !== lastStepCount || data.status !== lastStatus);
        if (progressed) {
          backoffIdx = 0;
          lastStepCount = typeof data.stepCount === 'number' ? data.stepCount : lastStepCount;
          lastStatus = typeof data.status === 'string' ? data.status : lastStatus;
        } else {
          backoffIdx = Math.min(backoffIdx + 1, POLL_BACKOFF_SCHEDULE_MS.length - 1);
        }
      } catch {
        // Transient fetch failures — advance the backoff so we don't
        // hammer a flapping endpoint, then try again on the next tick.
        backoffIdx = Math.min(backoffIdx + 1, POLL_BACKOFF_SCHEDULE_MS.length - 1);
      }
      scheduleNext();
    };

    // Pause polling when the tab is hidden (avoid N parallel poll loops
    // across tabs and the thundering herd on resume). Resume immediately
    // when the tab becomes visible again.
    const startPolling = () => {
      if (timer) return;
      fetchProgress();
    };
    const stopPolling = () => {
      clearTimer();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') startPolling();
      else stopPolling();
    };

    if (document.visibilityState === 'visible') startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [ieeRunId, subaccountId]);

  // When progress reports a terminal IEE state but the parent run hasn't
  // caught up yet (eventual consistency), trigger a refresh so the user
  // sees the terminal transition as soon as it lands. Reconciliation will
  // close the gap within 2 minutes worst case.
  useEffect(() => {
    if (!ieeProgress) return;
    if (['completed', 'failed', 'cancelled'].includes(ieeProgress.status) && run?.status === AGENT_RUN_STATUS.DELEGATED) {
      const timer = setTimeout(refreshRun, 1_000);
      return () => clearTimeout(timer);
    }
  }, [ieeProgress, run?.status, refreshRun]);

  const handleSelectRun = useCallback((id: string) => {
    setActiveRunId(id);
    if (subaccountId) navigate(`/admin/subaccounts/${subaccountId}/runs/${id}`, { replace: true });
  }, [navigate, subaccountId]);

  const toolCallsRef = useRef<HTMLDivElement | null>(null);
  const handleSelectToolCallFromPlan = useCallback((index: number) => {
    if (toolCallsRef.current) {
      toolCallsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const card = toolCallsRef.current.querySelector(`[data-tool-call-index="${index}"]`);
      if (card) {
        card.classList.add('ring-2', 'ring-indigo-400');
        setTimeout(() => card.classList.remove('ring-2', 'ring-indigo-400'), 1500);
      }
    }
  }, []);

  if (loading) {
    return (
      <div className="animate-[fadeIn_0.2s_ease-out_both]">
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="animate-[fadeIn_0.2s_ease-out_both]">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700 text-[14px]">
          {error ?? 'Run not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 animate-[fadeIn_0.2s_ease-out_both]">
      <TraceChainSidebar runId={runId!} onSelectRun={handleSelectRun} />
      <div className="flex-1 max-w-[960px] mx-auto">
        {/* Breadcrumb */}
        <div className="mb-4 text-[13px] text-slate-500 flex items-center gap-1.5">
          {run.subaccountId ? (
            <Link
              to={`/admin/subaccounts/${run.subaccountId}/workspace`}
              className="text-indigo-600 hover:text-indigo-700 no-underline font-medium"
            >
              {run.subaccountName ?? 'Workspace'}
            </Link>
          ) : (
            <span className="font-medium text-slate-600">Org</span>
          )}
          <span>/</span>
          <span>Run Trace</span>
        </div>

        {/* Chain timeline */}
        {chainRuns.length > 1 && (
          <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 mb-4">
            <h3 className="text-[13px] font-semibold text-slate-500 uppercase tracking-wider mb-3 mt-0">Chain Timeline</h3>
            <TraceChainTimeline runs={chainRuns} selectedRunId={runId!} onSelectRun={handleSelectRun} />
          </div>
        )}

        {/* IEE Phase 0 — delegated run live progress panel */}
        {run.status === AGENT_RUN_STATUS.DELEGATED && ieeProgress && !isTerminalRunStatus(run.status) && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-5 py-4 mb-4 flex items-center gap-3 text-[13px] text-indigo-800">
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            <div className="font-medium">Delegated to IEE worker</div>
            <div className="text-indigo-600">·</div>
            <div>Step {ieeProgress.stepCount}</div>
            {ieeProgress.heartbeatAgeSeconds !== null && (
              <>
                <div className="text-indigo-600">·</div>
                <div>Last heartbeat {ieeProgress.heartbeatAgeSeconds}s ago</div>
              </>
            )}
            <div className="ml-auto text-[12px] text-indigo-600 font-medium">
              worker status: {ieeProgress.status}
            </div>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-0 border-b border-slate-200 mb-4">
          <button
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === 'trace'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
            onClick={() => setActiveTab('trace')}
          >
            Trace
          </button>
          <button
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === 'delegation-graph'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
            onClick={() => setActiveTab('delegation-graph')}
          >
            Delegation Graph
          </button>
        </div>

        {activeTab === 'trace' && <RunTraceView run={run} toolCallsRef={toolCallsRef} />}

        {activeTab === 'delegation-graph' && (
          <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
            <DelegationGraphView runId={activeRunId} />
          </div>
        )}
      </div>

      <ExecutionPlanPane
        run={{ status: run.status, planJson: run.planJson, toolCallsLog: run.toolCallsLog }}
        onSelectToolCall={handleSelectToolCallFromPlan}
      />
    </div>
  );
}
