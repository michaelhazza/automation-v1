// client/src/pages/govern/ModelBenchPage.tsx
// Model Bench page — three states: Setup, Running, Results.
// Trust & Verification Layer spec §12.4, §14.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { EmptyState } from '../../components/EmptyState';
import {
  estimateBenchRun,
  runBenchRun,
  getBenchRun,
  getBenchResults,
  approveBenchRun,
  type BenchEstimateResult,
  type BenchRun,
  type BenchResult,
} from '../../lib/api/benchRuns';
import {
  formatCostEstimate,
  riskPillClass,
  riskLabel,
  benchStateLabel,
  verdictPassRate,
  formatPassRate,
  computeRegressionRisk,
} from '../../lib/benchUiPure';

// ── Setup state ───────────────────────────────────────────────────────────────

const DEFAULT_JUDGE = 'claude-haiku-4-5-20251001';

const CANDIDATE_OPTIONS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
  'gpt-4o',
  'gpt-4o-mini',
];

interface SetupState {
  candidateModelIds: string[];
  judgeModelId: string;
  sampleCount: number;
  targetAgentId: string;
  estimate: BenchEstimateResult | null;
  estimating: boolean;
  estimateError: string | null;
  running: boolean;
  runError: string | null;
}

function SetupView({
  state,
  onStateChange,
  onEstimate,
  onRun,
}: {
  state: SetupState;
  onStateChange: (patch: Partial<SetupState>) => void;
  onEstimate: () => void;
  onRun: () => void;
}) {
  function toggleCandidate(modelId: string) {
    const next = state.candidateModelIds.includes(modelId)
      ? state.candidateModelIds.filter((m) => m !== modelId)
      : [...state.candidateModelIds, modelId];
    onStateChange({ candidateModelIds: next, estimate: null });
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-8 space-y-6">
      {state.estimateError && (
        <div className="rounded bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
          {state.estimateError}
        </div>
      )}
      {state.runError && (
        <div className="rounded bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
          {state.runError}
        </div>
      )}
      {state.estimate?.judgeSwapNotice && (
        <div className="rounded bg-amber-50 border border-amber-200 text-amber-700 text-sm px-4 py-3">
          {state.estimate.judgeSwapNotice}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">Candidate models</label>
        <div className="flex flex-wrap gap-2">
          {CANDIDATE_OPTIONS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => toggleCandidate(m)}
              className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                state.candidateModelIds.includes(m)
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Sample count: {state.sampleCount}
        </label>
        <input
          type="range"
          min={1}
          max={50}
          value={state.sampleCount}
          onChange={(e) => onStateChange({ sampleCount: Number(e.target.value), estimate: null })}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-slate-400">
          <span>1</span><span>50</span>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Target agent ID (optional)</label>
        <input
          type="text"
          value={state.targetAgentId}
          onChange={(e) => onStateChange({ targetAgentId: e.target.value, estimate: null })}
          className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          placeholder="Agent UUID — leave blank for paste-in samples"
        />
      </div>

      <div className="border border-slate-100 rounded-lg p-4 bg-slate-50">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Estimated cost</span>
          {state.estimate ? (
            <span className="text-sm font-semibold text-slate-900">
              {formatCostEstimate(state.estimate.estimatedCostCents)}
            </span>
          ) : (
            <span className="text-sm text-slate-400">—</span>
          )}
        </div>
        <button
          type="button"
          onClick={onEstimate}
          disabled={state.candidateModelIds.length === 0 || state.estimating}
          className="mt-3 w-full text-sm text-indigo-600 hover:text-indigo-700 disabled:opacity-40 font-medium"
        >
          {state.estimating ? 'Estimating...' : 'Calculate estimate'}
        </button>
      </div>

      <button
        type="button"
        onClick={onRun}
        disabled={!state.estimate || state.running || state.candidateModelIds.length === 0}
        className="w-full py-2 rounded bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
      >
        {state.running ? 'Starting...' : 'Run bench'}
      </button>
    </div>
  );
}

// ── Running state ─────────────────────────────────────────────────────────────

function RunningView({ run }: { run: BenchRun }) {
  return (
    <div className="max-w-xl mx-auto px-6 py-16 text-center space-y-4">
      <div className="w-10 h-10 border-[3px] border-slate-200 border-t-indigo-500 rounded-full [animation:spin_0.8s_linear_infinite] mx-auto" />
      <p className="text-sm font-medium text-slate-700">{benchStateLabel(run.state)}</p>
      <p className="text-xs text-slate-400">
        {run.candidateModelIds.length} candidate{run.candidateModelIds.length !== 1 ? 's' : ''} &times; {run.sampleCount} samples
      </p>
    </div>
  );
}

// ── Results state ─────────────────────────────────────────────────────────────

function ResultsView({
  run,
  results,
  onApprove,
  approving,
  approveError,
}: {
  run: BenchRun;
  results: BenchResult[];
  onApprove: (modelId: string) => void;
  approving: boolean;
  approveError: string | null;
}) {
  const recommended = run.summary?.recommendedModelId;

  return (
    <div className="px-6 py-6 space-y-4">
      {approveError && (
        <div className="rounded bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
          {approveError}
        </div>
      )}
      {run.state === 'partial' && (
        <div className="rounded bg-amber-50 border border-amber-200 text-amber-700 text-sm px-4 py-3">
          Some samples failed — results may be incomplete.
        </div>
      )}
      {run.summary?.reason && (
        <p className="text-sm text-slate-600">{run.summary.reason}</p>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Model</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Pass rate</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Samples</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Risk</th>
              {run.state === 'awaiting_approval' && run.approvedModelId === null && (
                <th className="px-4 py-3" />
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {run.candidateModelIds.map((modelId) => {
              const modelResults = results.filter((r) => r.candidateModelId === modelId);
              const passRate = verdictPassRate(results, modelId);
              const scores = modelResults.map((r) => r.score ?? 0);
              const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
              const variance = scores.length
                ? scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length
                : 1;
              const risk = computeRegressionRisk(variance, modelResults.length);
              const isRecommended = modelId === recommended;

              return (
                <tr
                  key={modelId}
                  className={`hover:bg-slate-50 ${isRecommended ? 'bg-green-50' : ''}`}
                >
                  <td className="py-3 font-mono text-xs text-slate-700">
                    {modelId}
                    {isRecommended && (
                      <span className="ml-2 text-xs text-green-600 font-medium">Recommended</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">
                    {formatPassRate(passRate)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">{modelResults.length}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${riskPillClass(risk)}`}>
                      {riskLabel(risk)}
                    </span>
                  </td>
                  {run.state === 'awaiting_approval' && run.approvedModelId === null && (
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => onApprove(modelId)}
                        disabled={approving}
                        className="text-xs text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-40"
                      >
                        Approve as default
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {run.approvedModelId && (
        <div className="rounded bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3">
          Approved model: <span className="font-mono font-medium">{run.approvedModelId}</span>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ModelBenchPage() {
  const navigate = useNavigate();
  const [setup, setSetup] = useState<SetupState>({
    candidateModelIds: [],
    judgeModelId: DEFAULT_JUDGE,
    sampleCount: 5,
    targetAgentId: '',
    estimate: null,
    estimating: false,
    estimateError: null,
    running: false,
    runError: null,
  });

  const [activeBenchRunId, setActiveBenchRunId] = useState<string | null>(null);
  const [benchRun, setBenchRun] = useState<BenchRun | null>(null);
  const [benchResults, setBenchResults] = useState<BenchResult[]>([]);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollRun = useCallback(async (runId: string) => {
    try {
      const run = await getBenchRun(runId);
      setBenchRun(run);
      if (run.state === 'awaiting_approval' || run.state === 'completed' || run.state === 'partial') {
        const results = await getBenchResults(runId);
        setBenchResults(results);
      }
      if (run.state === 'running' || run.state === 'awaiting_confirm') {
        pollRef.current = setTimeout(() => pollRun(runId), 3000);
      }
    } catch {
      pollRef.current = setTimeout(() => pollRun(runId), 5000);
    }
  }, []);

  useEffect(() => {
    if (!activeBenchRunId) return;
    pollRun(activeBenchRunId);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [activeBenchRunId, pollRun]);

  async function handleEstimate() {
    if (setup.candidateModelIds.length === 0) return;
    setSetup((s) => ({ ...s, estimating: true, estimateError: null }));
    try {
      const result = await estimateBenchRun({
        candidateModelIds: setup.candidateModelIds,
        judgeModelId: setup.judgeModelId,
        sampleCount: setup.sampleCount,
        targetAgentId: setup.targetAgentId || null,
      });
      setSetup((s) => ({ ...s, estimating: false, estimate: result }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Estimate failed';
      setSetup((s) => ({ ...s, estimating: false, estimateError: msg }));
    }
  }

  async function handleRun() {
    if (!setup.estimate) return;
    setSetup((s) => ({ ...s, running: true, runError: null }));
    try {
      await runBenchRun(setup.estimate.benchRunId);
      setActiveBenchRunId(setup.estimate.benchRunId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start bench';
      setSetup((s) => ({ ...s, running: false, runError: msg }));
    }
  }

  async function handleApprove(modelId: string) {
    if (!activeBenchRunId) return;
    setApproving(true);
    setApproveError(null);
    try {
      await approveBenchRun(activeBenchRunId, modelId);
      const run = await getBenchRun(activeBenchRunId);
      setBenchRun(run);
    } catch (err: unknown) {
      setApproveError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setApproving(false);
    }
  }

  const isRunning = benchRun && (benchRun.state === 'running' || benchRun.state === 'awaiting_confirm');
  const showResults = benchRun && (
    benchRun.state === 'awaiting_approval' ||
    benchRun.state === 'completed' ||
    benchRun.state === 'partial'
  );
  const showSetup = !activeBenchRunId;

  return (
    <PageShell
      header={
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <button
            type="button"
            onClick={() => navigate('/quality?tab=bench')}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            &larr;
          </button>
          <h1 className="text-lg font-semibold text-slate-900">Model Bench</h1>
        </div>
      }
    >
      {showSetup && (
        <SetupView
          state={setup}
          onStateChange={(patch) => setSetup((s) => ({ ...s, ...patch }))}
          onEstimate={handleEstimate}
          onRun={handleRun}
        />
      )}
      {isRunning && <RunningView run={benchRun!} />}
      {showResults && benchRun && (
        <ResultsView
          run={benchRun}
          results={benchResults}
          onApprove={handleApprove}
          approving={approving}
          approveError={approveError}
        />
      )}
      {benchRun?.state === 'failed' && (
        <EmptyState
          title="Bench run failed"
          body={benchRun.failureReason ?? 'All samples failed.'}
          primaryAction={{ label: 'Try again', onClick: () => { setBenchRun(null); setActiveBenchRunId(null); } }}
        />
      )}
    </PageShell>
  );
}
