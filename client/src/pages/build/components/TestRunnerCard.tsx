import React, { useState, useRef, useEffect } from 'react';
import { buildApi } from '../../../lib/api/build';
import type { AgentTestResult } from '../../../../../shared/types/build';
import { getActiveClientId } from '../../../lib/auth';

interface TestRunnerCardProps {
  agentId: string;
}

export function TestRunnerCard({ agentId }: TestRunnerCardProps) {
  const [input, setInput] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [result, setResult] = useState<AgentTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll for result while status is 'running'
  useEffect(() => {
    if (!runId) return;
    if (result?.status !== 'running' && result !== null) return;

    const poll = async () => {
      try {
        const r = await buildApi.getAgentRunForTest(runId);
        setResult(r);
        if (r.status === 'running') {
          pollRef.current = setTimeout(poll, 1500);
        }
      } catch {
        setError('Failed to fetch test result.');
      }
    };

    pollRef.current = setTimeout(poll, 1500);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [runId, result]);

  const inFlight = !!runId && (!result || result.status === 'running');

  const handleRun = async () => {
    if (!input.trim() || inFlight) return;
    setError(null);
    setResult(null);
    setRunId(null);
    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await buildApi.testRun(agentId, {
        input,
        workspaceContextId: getActiveClientId() ?? '',
        idempotencyKey,
      });
      setRunId(res.runId);
      // Seed initial running state so the effect starts polling
      setResult({ runId: res.runId, status: 'running', durationMs: null, resultPreview: null, traceUrl: null });
    } catch {
      setError('Failed to start test run.');
    }
  };

  return (
    <div className="section-card p-4 border border-slate-200 rounded-lg">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Test runner</h3>
      <textarea
        className="w-full p-3 text-sm border border-slate-200 rounded-md resize-y min-h-[80px] font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300"
        placeholder="Enter test input..."
        value={input}
        onChange={e => setInput(e.target.value)}
        disabled={inFlight}
      />
      <div className="flex items-center gap-3 mt-2">
        <button
          disabled={inFlight || !input.trim()}
          onClick={handleRun}
          className="btn btn-primary text-sm"
        >
          {inFlight ? 'Running...' : 'Run test'}
        </button>
        {result && (
          <span className="text-xs text-slate-500">
            {result.status === 'running'
              ? 'Running...'
              : `${result.status} in ${((result.durationMs ?? 0) / 1000).toFixed(1)}s`}
          </span>
        )}
        {result?.traceUrl && (
          <a href={result.traceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline ml-auto">
            View trace
          </a>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      {result?.status === 'completed' && result.resultPreview && (
        <div className="mt-3 p-3 bg-slate-50 rounded-md">
          <p className="text-xs text-slate-600 font-mono whitespace-pre-wrap">{result.resultPreview}</p>
        </div>
      )}
      {result?.status === 'failed' && (
        <div className="mt-3 p-3 bg-red-50 rounded-md">
          <p className="text-xs text-red-600">Test run failed.{result.traceUrl ? ' See trace for details.' : ''}</p>
        </div>
      )}
    </div>
  );
}
