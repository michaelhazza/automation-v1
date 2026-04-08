/**
 * PlaybookRunDetailPage — vertical stepper showing every step run with
 * status, output, and inline action affordances (form for awaiting_input,
 * approve/reject/edit for awaiting_approval).
 *
 * Spec: tasks/playbooks-spec.md §9.2.
 *
 * Phase 1: polls every 3 seconds for state updates. Live WebSocket
 * subscription to playbook-run:{runId} ships in step 7 / Phase 1.5.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import type { User } from '../lib/auth';
import { useSocketRoom } from '../hooks/useSocket';

interface StepRun {
  id: string;
  stepId: string;
  stepType: 'prompt' | 'agent_call' | 'user_input' | 'approval' | 'conditional';
  status:
    | 'pending'
    | 'running'
    | 'awaiting_input'
    | 'awaiting_approval'
    | 'completed'
    | 'failed'
    | 'skipped'
    | 'invalidated';
  sideEffectType: 'none' | 'idempotent' | 'reversible' | 'irreversible';
  dependsOn: string[];
  inputJson: Record<string, unknown> | null;
  outputJson: Record<string, unknown> | null;
  error: string | null;
  attempt: number;
  version: number;
  startedAt: string | null;
  completedAt: string | null;
}

interface StepDef {
  id: string;
  name: string;
  description?: string;
  type: StepRun['stepType'];
  sideEffectType: StepRun['sideEffectType'];
  dependsOn: string[];
  approvalPrompt?: string;
}

interface RunResponse {
  run: {
    id: string;
    status: string;
    contextJson: Record<string, unknown>;
    error: string | null;
    failedDueToStepId: string | null;
    startedAt: string | null;
    completedAt: string | null;
  };
  stepRuns: StepRun[];
  definition: { name?: string; steps?: StepDef[] } | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  running: 'bg-blue-100 text-blue-800',
  awaiting_input: 'bg-amber-100 text-amber-800',
  awaiting_approval: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
  skipped: 'bg-slate-100 text-slate-500',
  invalidated: 'bg-slate-100 text-slate-400 line-through',
  completed_with_errors: 'bg-amber-100 text-amber-800',
  cancelling: 'bg-slate-200 text-slate-700',
  cancelled: 'bg-slate-200 text-slate-600',
};

const SIDE_EFFECT_COLORS: Record<string, string> = {
  none: 'text-slate-500',
  idempotent: 'text-blue-600',
  reversible: 'text-amber-600',
  irreversible: 'text-red-600',
};

export default function PlaybookRunDetailPage(_props: { user: User }) {
  const { runId } = useParams<{ runId: string }>();
  const [data, setData] = useState<RunResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionStepId, setActionStepId] = useState<string | null>(null);
  const [formData, setFormData] = useState('{\n  \n}');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!runId) return;
    try {
      const res = await api.get(`/api/playbook-runs/${runId}`);
      setData(res.data as RunResponse);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load run');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // WebSocket live updates. Any event triggers a full refresh — Phase 1.5
  // can switch to applying patches in place once we have telemetry on
  // event volume. Polling fallback (every 10s) covers reconnect gaps.
  useSocketRoom(
    'playbook-run',
    runId ?? null,
    {
      'playbook:run:status': () => refresh(),
      'playbook:step:dispatched': () => refresh(),
      'playbook:step:completed': () => refresh(),
      'playbook:step:failed': () => refresh(),
      'playbook:step:awaiting_input': () => refresh(),
      'playbook:step:awaiting_approval': () => refresh(),
    },
    refresh
  );

  // Lightweight backstop poll — covers any missed events.
  useEffect(() => {
    if (!data) return;
    const terminalStatuses = ['completed', 'completed_with_errors', 'failed', 'cancelled'];
    if (terminalStatuses.includes(data.run.status)) return;
    const id = setInterval(() => {
      refresh();
    }, 10000);
    return () => clearInterval(id);
  }, [data, refresh]);

  async function submitInput(stepRunId: string, stepRunVersion: number) {
    setActionSubmitting(true);
    setActionError(null);
    try {
      const parsed = JSON.parse(formData);
      await api.post(`/api/playbook-runs/${runId}/steps/${stepRunId}/input`, {
        data: parsed,
        expectedVersion: stepRunVersion,
      });
      setActionStepId(null);
      setFormData('{\n  \n}');
      await refresh();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data
          ?.error ??
        (err instanceof Error ? err.message : 'Failed to submit');
      setActionError(msg);
    } finally {
      setActionSubmitting(false);
    }
  }

  async function decideApproval(
    stepRunId: string,
    stepRunVersion: number,
    decision: 'approved' | 'rejected'
  ) {
    setActionSubmitting(true);
    setActionError(null);
    try {
      await api.post(`/api/playbook-runs/${runId}/steps/${stepRunId}/approve`, {
        decision,
        expectedVersion: stepRunVersion,
      });
      await refresh();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data
          ?.error ??
        (err instanceof Error ? err.message : 'Failed to decide');
      setActionError(msg);
    } finally {
      setActionSubmitting(false);
    }
  }

  async function cancelRun() {
    if (!runId) return;
    if (!confirm('Cancel this playbook run?')) return;
    try {
      await api.post(`/api/playbook-runs/${runId}/cancel`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel');
    }
  }

  if (loading) {
    return <div className="p-6 text-slate-500">Loading run…</div>;
  }
  if (error || !data) {
    return (
      <div className="p-6">
        <Link to="/playbooks" className="text-blue-600 hover:underline text-sm">
          ← Back to Playbooks
        </Link>
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-red-800">
          {error ?? 'Run not found'}
        </div>
      </div>
    );
  }

  const totalSteps = data.definition?.steps?.length ?? data.stepRuns.length;
  const completedSteps = data.stepRuns.filter((s) => s.status === 'completed').length;
  const stepDefById = new Map(
    (data.definition?.steps ?? []).map((s) => [s.id, s])
  );

  // Order step runs by topological order from the definition (fall back to creation order).
  const orderedStepRuns = [...data.stepRuns].sort((a, b) => {
    const idxA = (data.definition?.steps ?? []).findIndex((s) => s.id === a.stepId);
    const idxB = (data.definition?.steps ?? []).findIndex((s) => s.id === b.stepId);
    return idxA - idxB;
  });

  const isTerminal = ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(
    data.run.status
  );

  return (
    <div className="p-6 max-w-4xl">
      <Link to="/playbooks" className="text-blue-600 hover:underline text-sm">
        ← Back to Playbooks
      </Link>

      <div className="mt-4 mb-6 border-b border-slate-200 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{data.definition?.name ?? 'Playbook run'}</h1>
            <p className="text-sm text-slate-500 mt-1">
              {completedSteps} / {totalSteps} steps · started{' '}
              {data.run.startedAt ? new Date(data.run.startedAt).toLocaleString() : '—'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                STATUS_COLORS[data.run.status] ?? 'bg-slate-100 text-slate-700'
              }`}
            >
              {data.run.status}
            </span>
            {!isTerminal && (
              <button
                onClick={cancelRun}
                className="px-3 py-1.5 text-sm rounded border border-slate-300 hover:bg-slate-50"
              >
                Cancel run
              </button>
            )}
          </div>
        </div>
        {data.run.error && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {data.run.error}
            {data.run.failedDueToStepId && (
              <span className="text-red-600">
                {' '}
                — root cause: <code>{data.run.failedDueToStepId}</code>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {orderedStepRuns.map((sr) => {
          const def = stepDefById.get(sr.stepId);
          return (
            <div key={sr.id} className="rounded-lg border border-slate-200 bg-white">
              <div className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{def?.name ?? sr.stepId}</span>
                      <span className="text-xs text-slate-400">({sr.stepType})</span>
                      <span
                        className={`text-xs uppercase tracking-wide ${
                          SIDE_EFFECT_COLORS[sr.sideEffectType] ?? ''
                        }`}
                      >
                        {sr.sideEffectType}
                      </span>
                    </div>
                    {sr.dependsOn.length > 0 && (
                      <div className="text-xs text-slate-500 mb-2">
                        depends on:{' '}
                        {sr.dependsOn.map((d) => (
                          <code key={d} className="mr-1">
                            {d}
                          </code>
                        ))}
                      </div>
                    )}
                    {sr.error && (
                      <div className="mt-2 text-xs text-red-700 bg-red-50 px-2 py-1 rounded">
                        {sr.error}
                      </div>
                    )}
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      STATUS_COLORS[sr.status] ?? 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {sr.status}
                  </span>
                </div>

                {sr.outputJson && sr.status === 'completed' && (
                  <details className="mt-3">
                    <summary className="text-xs text-slate-500 cursor-pointer">Output</summary>
                    <pre className="mt-2 text-xs bg-slate-50 border border-slate-200 rounded p-2 overflow-auto max-h-60">
                      {JSON.stringify(sr.outputJson, null, 2)}
                    </pre>
                  </details>
                )}

                {sr.status === 'awaiting_input' && (
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    {actionStepId === sr.id ? (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-500">
                          Provide form input as JSON matching the step&rsquo;s schema:
                        </p>
                        <textarea
                          value={formData}
                          onChange={(e) => setFormData(e.target.value)}
                          className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs h-28"
                        />
                        {actionError && (
                          <div className="text-xs text-red-700">{actionError}</div>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => submitInput(sr.id, sr.version)}
                            disabled={actionSubmitting}
                            className="px-3 py-1 text-xs rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            {actionSubmitting ? 'Submitting…' : 'Submit'}
                          </button>
                          <button
                            onClick={() => {
                              setActionStepId(null);
                              setActionError(null);
                            }}
                            className="px-3 py-1 text-xs rounded border border-slate-300 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setActionStepId(sr.id);
                          setFormData('{\n  \n}');
                        }}
                        className="px-3 py-1 text-xs rounded bg-amber-500 text-white hover:bg-amber-600"
                      >
                        Provide input
                      </button>
                    )}
                  </div>
                )}

                {sr.status === 'awaiting_approval' && (
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    {def?.approvalPrompt && (
                      <p className="text-sm text-slate-600 mb-2">{def.approvalPrompt}</p>
                    )}
                    {actionError && actionStepId === sr.id && (
                      <div className="text-xs text-red-700 mb-2">{actionError}</div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setActionStepId(sr.id);
                          decideApproval(sr.id, sr.version, 'approved');
                        }}
                        disabled={actionSubmitting}
                        className="px-3 py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => {
                          setActionStepId(sr.id);
                          decideApproval(sr.id, sr.version, 'rejected');
                        }}
                        disabled={actionSubmitting}
                        className="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
