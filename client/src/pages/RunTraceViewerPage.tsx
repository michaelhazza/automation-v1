import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import { AGENT_RUN_STATUS, isTerminalRunStatus } from '../lib/runStatus';
import { useSocketRoom } from '../hooks/useSocket';
import TraceChainSidebar from '../components/TraceChainSidebar';
import TraceChainTimeline from '../components/TraceChainTimeline';
import ExecutionPlanPane from '../components/ExecutionPlanPane';
import RunTraceView, { type RunDetail } from '../components/runs/RunTraceView';

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
 * Extract the ieeRunId from the delegated-run summary string. Format is
 * controlled server-side by agentExecutionService (Phase 0):
 *   "Delegated to IEE browser (ieeRunId=<uuid>...)".
 */
function extractIeeRunId(summary: string | null | undefined): string | null {
  if (!summary) return null;
  const match = summary.match(/ieeRunId=([0-9a-f-]{36})/i);
  return match?.[1] ?? null;
}

export default function RunTraceViewerPage({ user: _user }: { user: User }) {
  const { subaccountId, runId: routeRunId } = useParams<{ subaccountId: string; runId: string }>();
  const navigate = useNavigate();
  const [activeRunId, setActiveRunId] = useState(routeRunId ?? '');
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chainRuns, setChainRuns] = useState<Array<{
    id: string; agentName: string; isSubAgent: boolean; runSource: string;
    status: string; startedAt: string | null; completedAt: string | null;
    durationMs: number | null; totalTokens: number | null;
  }>>([]);

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
  const ieeRunId = run?.status === AGENT_RUN_STATUS.DELEGATED
    ? extractIeeRunId(run?.summary)
    : null;

  useEffect(() => {
    if (!ieeRunId) {
      setIeeProgress(null);
      return;
    }
    let cancelled = false;
    const fetchProgress = async () => {
      try {
        const { data } = await api.get(`/api/iee/runs/${ieeRunId}/progress`);
        if (!cancelled) setIeeProgress(data);
      } catch {
        // Transient fetch failures are acceptable — the next tick will retry.
      }
    };
    fetchProgress();
    const interval = setInterval(fetchProgress, 3_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [ieeRunId]);

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

        <RunTraceView run={run} toolCallsRef={toolCallsRef} />
      </div>

      <ExecutionPlanPane
        run={{ status: run.status, planJson: run.planJson, toolCallsLog: run.toolCallsLog }}
        onSelectToolCall={handleSelectToolCallFromPlan}
      />
    </div>
  );
}
