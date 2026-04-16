import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import TraceChainSidebar from '../components/TraceChainSidebar';
import TraceChainTimeline from '../components/TraceChainTimeline';
import ExecutionPlanPane from '../components/ExecutionPlanPane';
import RunTraceView, { type RunDetail } from '../components/runs/RunTraceView';

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

        <RunTraceView run={run} toolCallsRef={toolCallsRef} />
      </div>

      <ExecutionPlanPane
        run={{ status: run.status, planJson: run.planJson, toolCallsLog: run.toolCallsLog }}
        onSelectToolCall={handleSelectToolCallFromPlan}
      />
    </div>
  );
}
