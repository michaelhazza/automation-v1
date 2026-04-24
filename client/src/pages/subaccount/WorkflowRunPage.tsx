/**
 * WorkflowRunPage — the subaccount-scoped three-pane run modal described in
 * docs/onboarding-Workflows-spec.md §9.2.
 *
 * Layout:
 *   ┌─ Header: name, version, status pill, kebab (Cancel/Replay/Portal toggle) ─┐
 *   │  Left rail: step DAG (read-only)   │   Right: selected step detail       │
 *   │                                    │   (type, timing, input, output)     │
 *   │                                    │   ┌ HITL action bar (sticky) ────── │
 *   └────────────────────────────────────┴─────────────────────────────────────┘
 *
 * Data:
 *   - Baseline: GET /api/subaccounts/:id/Workflow-runs/:runId/envelope
 *   - Live updates: WS room `Workflow-run:${runId}` with full refresh on event
 *   - Fallback: 12s polling while disconnected AND run.status === 'running'
 *     (stops at terminal status per spec §9.2)
 *
 * Three surfaces / one run object (§9.1): this page is the authoritative
 * timeline for both admin and sub-account viewers. Portal-card and
 * onboarding-tab surfaces render elsewhere.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../../lib/api';
import type { User } from '../../lib/auth';
import { useSocketRoom, useSocketConnected } from '../../hooks/useSocket';
import ConfirmDialog from '../../components/ConfirmDialog';
import { HelpHint } from '../../components/ui/HelpHint';

// ─── Types (mirror server shapes; avoid importing server code into client) ───

type StepType =
  | 'prompt'
  | 'agent_call'
  | 'user_input'
  | 'approval'
  | 'conditional'
  | 'agent_decision'
  | 'action_call';

type SideEffectType = 'none' | 'idempotent' | 'reversible' | 'irreversible';

type StepRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'invalidated';

type RunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelling'
  | 'cancelled'
  | 'partial';

interface StepRun {
  id: string;
  stepId: string;
  stepType: StepType;
  status: StepRunStatus;
  sideEffectType: SideEffectType;
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
  type: StepType;
  sideEffectType: SideEffectType;
  dependsOn: string[];
  humanReviewRequired?: boolean;
  approvalPrompt?: string;
  actionSlug?: string;
}

interface RunRow {
  id: string;
  status: RunStatus;
  runMode: string;
  contextJson: Record<string, unknown>;
  error: string | null;
  failedDueToStepId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  isPortalVisible: boolean;
  isOnboardingRun: boolean;
  WorkflowSlug: string | null;
}

interface Envelope {
  run: RunRow;
  stepRuns: StepRun[];
  definition: {
    slug?: string;
    name?: string;
    version?: number;
    steps?: StepDef[];
  } | null;
  resolvedAgents: Record<string, string>;
  events: Array<unknown>;
}

// ─── Presentation constants ──────────────────────────────────────────────────

const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
];

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  running: 'bg-blue-100 text-blue-800',
  awaiting_input: 'bg-amber-100 text-amber-800',
  awaiting_approval: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-800',
  completed_with_errors: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-800',
  skipped: 'bg-slate-100 text-slate-500',
  invalidated: 'bg-slate-100 text-slate-400 line-through',
  cancelling: 'bg-slate-200 text-slate-700',
  cancelled: 'bg-slate-200 text-slate-600',
  partial: 'bg-amber-100 text-amber-800',
};

const STATUS_DOT_COLORS: Record<string, string> = {
  pending: 'bg-slate-300',
  running: 'bg-blue-500 animate-pulse',
  awaiting_input: 'bg-amber-500',
  awaiting_approval: 'bg-amber-500',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
  skipped: 'bg-slate-300',
  invalidated: 'bg-slate-300',
};

const SIDE_EFFECT_COLORS: Record<string, string> = {
  none: 'text-slate-500',
  idempotent: 'text-blue-600',
  reversible: 'text-amber-600',
  irreversible: 'text-red-600',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function WorkflowRunPage(_props: { user: User }) {
  const { subaccountId, runId } = useParams<{ subaccountId: string; runId: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<Envelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStepRunId, setSelectedStepRunId] = useState<string | null>(null);

  // ── Envelope fetch ────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    if (!subaccountId || !runId) return;
    try {
      const res = await api.get(
        `/api/subaccounts/${subaccountId}/Workflow-runs/${runId}/envelope`,
      );
      const env = res.data as Envelope;
      setData(env);
      setError(null);
      // Default selection: first awaiting_* or running step, else first step.
      setSelectedStepRunId((prev) => {
        if (prev && env.stepRuns.some((s) => s.id === prev)) return prev;
        const actionable = env.stepRuns.find(
          (s) => s.status === 'awaiting_approval' || s.status === 'awaiting_input',
        );
        if (actionable) return actionable.id;
        const running = env.stepRuns.find((s) => s.status === 'running');
        if (running) return running.id;
        return env.stepRuns[0]?.id ?? null;
      });
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err instanceof Error ? err.message : 'Failed to load run');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [subaccountId, runId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ── Live updates over the `Workflow-run:${runId}` WebSocket room ──────────

  useSocketRoom(
    'Workflow-run',
    runId ?? null,
    {
      'Workflow:run:status': () => refresh(),
      'Workflow:run:bulk_fanout': () => refresh(),
      'Workflow:step:dispatched': () => refresh(),
      'Workflow:step:completed': () => refresh(),
      'Workflow:step:failed': () => refresh(),
      'Workflow:step:awaiting_input': () => refresh(),
      'Workflow:step:awaiting_approval': () => refresh(),
      'Workflow:step:run_now_skipped_replay': () => refresh(),
    },
    refresh,
  );

  // ── Polling fallback (spec §9.2): 12s when WS is down AND run is running ──

  const wsConnected = useSocketConnected();

  useEffect(() => {
    if (!data) return;
    if (wsConnected) return;
    if (TERMINAL_RUN_STATUSES.includes(data.run.status)) return;
    const id = window.setInterval(() => {
      refresh();
    }, 12000);
    return () => window.clearInterval(id);
  }, [data, wsConnected, refresh]);

  const selectedStep = useMemo<StepRun | null>(() => {
    if (!data) return null;
    return data.stepRuns.find((s) => s.id === selectedStepRunId) ?? null;
  }, [data, selectedStepRunId]);

  const stepDefById = useMemo(() => {
    return new Map<string, StepDef>(
      (data?.definition?.steps ?? []).map((s) => [s.id, s]),
    );
  }, [data]);

  // Order step runs by the definition's topological order (fall back to
  // creation order when the definition can't be resolved — e.g. a seeded
  // template version that's been garbage-collected).
  const orderedStepRuns = useMemo<StepRun[]>(() => {
    if (!data) return [];
    const defSteps = data.definition?.steps ?? [];
    const order = new Map<string, number>(defSteps.map((s, idx) => [s.id, idx]));
    return [...data.stepRuns].sort((a, b) => {
      const ai = order.get(a.stepId) ?? Number.MAX_SAFE_INTEGER;
      const bi = order.get(b.stepId) ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      // Tie-break: createdAt order (stepRuns arrive ordered from the envelope)
      return 0;
    });
  }, [data]);

  // ── Header state ──────────────────────────────────────────────────────────

  const [kebabOpen, setKebabOpen] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showReplayConfirm, setShowReplayConfirm] = useState(false);

  useEffect(() => {
    if (!kebabOpen) return;
    const close = () => setKebabOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [kebabOpen]);

  // ── HITL action state ─────────────────────────────────────────────────────

  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inputFormOpen, setInputFormOpen] = useState(false);
  const [inputFormData, setInputFormData] = useState('{\n  \n}');
  const [editApproveOpen, setEditApproveOpen] = useState(false);
  const [editApproveData, setEditApproveData] = useState('{\n  \n}');

  // Reset inline forms whenever the selected step changes.
  useEffect(() => {
    setInputFormOpen(false);
    setEditApproveOpen(false);
    setInputFormData('{\n  \n}');
    setEditApproveData('{\n  \n}');
    setActionError(null);
  }, [selectedStepRunId]);

  async function submitStepInput(stepRunId: string, expectedVersion: number) {
    setActionSubmitting(true);
    setActionError(null);
    try {
      const parsed = JSON.parse(inputFormData);
      await api.post(
        `/api/Workflow-runs/${runId}/steps/${stepRunId}/input`,
        { data: parsed, expectedVersion },
      );
      setInputFormOpen(false);
      setInputFormData('{\n  \n}');
      toast.success('Input submitted');
      await refresh();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err instanceof Error ? err.message : 'Failed to submit input');
      setActionError(msg);
    } finally {
      setActionSubmitting(false);
    }
  }

  async function decideApproval(
    stepRunId: string,
    expectedVersion: number,
    decision: 'approved' | 'rejected' | 'edited',
    editedOutput?: Record<string, unknown>,
  ) {
    setActionSubmitting(true);
    setActionError(null);
    try {
      await api.post(
        `/api/Workflow-runs/${runId}/steps/${stepRunId}/approve`,
        { decision, editedOutput, expectedVersion },
      );
      setEditApproveOpen(false);
      toast.success(
        decision === 'approved'
          ? 'Step approved'
          : decision === 'edited'
            ? 'Output edited and approved'
            : 'Step rejected',
      );
      await refresh();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err instanceof Error ? err.message : 'Failed to submit decision');
      setActionError(msg);
    } finally {
      setActionSubmitting(false);
    }
  }

  async function handleCancelRun() {
    try {
      await api.post(`/api/Workflow-runs/${runId}/cancel`);
      toast.success('Cancellation requested');
      await refresh();
    } catch (err) {
      toast.error(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Failed to cancel run',
      );
    } finally {
      setShowCancelConfirm(false);
    }
  }

  async function handleReplayRun() {
    try {
      const res = await api.post(`/api/Workflow-runs/${runId}/replay`);
      const newRunId = (res.data as { runId?: string })?.runId;
      toast.success('Replay run created');
      if (newRunId && subaccountId) {
        navigate(`/sub/${subaccountId}/runs/${newRunId}`);
      }
    } catch (err) {
      toast.error(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Failed to create replay run',
      );
    } finally {
      setShowReplayConfirm(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-slate-500">Loading run…</div>;
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <Link
          to={subaccountId ? `/admin/subaccounts/${subaccountId}` : '/'}
          className="text-blue-600 hover:underline text-sm"
        >
          ← Back
        </Link>
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-red-800">
          {error ?? 'Run not found'}
        </div>
      </div>
    );
  }

  const { run, definition } = data;
  const WorkflowName = definition?.name ?? data.run.WorkflowSlug ?? 'Workflow run';
  const WorkflowVersion = definition?.version;
  const totalSteps = definition?.steps?.length ?? data.stepRuns.length;
  const completedSteps = data.stepRuns.filter((s) => s.status === 'completed').length;
  const runIsTerminal = TERMINAL_RUN_STATUSES.includes(run.status);
  const cancellable = !runIsTerminal && run.status !== 'cancelling';

  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)]">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <Link
          to={subaccountId ? `/admin/subaccounts/${subaccountId}` : '/'}
          className="text-xs text-blue-600 hover:underline"
        >
          ← Back to subaccount
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{WorkflowName}</h1>
              {WorkflowVersion !== undefined && (
                <span className="text-xs text-slate-400 font-mono">
                  v{WorkflowVersion}
                </span>
              )}
              {run.isOnboardingRun && (
                <span className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                  onboarding
                </span>
              )}
              {run.isPortalVisible && (
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                  portal-visible
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 mt-1">
              {completedSteps} / {totalSteps} steps · mode {run.runMode}
              {run.startedAt && (
                <>
                  {' · started '}
                  {new Date(run.startedAt).toLocaleString()}
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3 relative">
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                STATUS_COLORS[run.status] ?? 'bg-slate-100 text-slate-700'
              }`}
            >
              {run.status}
            </span>
            {!wsConnected && !runIsTerminal && (
              <span
                className="text-xs text-amber-700"
                title="Live updates disconnected — polling every 12 s"
              >
                ⚠ polling
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setKebabOpen((v) => !v);
              }}
              aria-haspopup="menu"
              aria-expanded={kebabOpen}
              className="w-8 h-8 rounded hover:bg-slate-100 flex items-center justify-center text-slate-500"
              title="More actions"
            >
              ⋮
            </button>
            {kebabOpen && (
              <div
                role="menu"
                className="absolute right-0 top-10 w-56 rounded-md border border-slate-200 bg-white shadow-lg z-10 text-sm"
                onClick={(e) => e.stopPropagation()}
              >
                {cancellable && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setKebabOpen(false);
                      setShowCancelConfirm(true);
                    }}
                    className="block w-full text-left px-3 py-2 hover:bg-slate-50"
                  >
                    Cancel run
                  </button>
                )}
                <button
                  role="menuitem"
                  onClick={() => {
                    setKebabOpen(false);
                    setShowReplayConfirm(true);
                  }}
                  className="block w-full text-left px-3 py-2 hover:bg-slate-50"
                >
                  Replay run
                </button>
                <div
                  role="menuitem"
                  className="flex items-center justify-between px-3 py-2 hover:bg-slate-50"
                >
                  <button
                    type="button"
                    onClick={async () => {
                      setKebabOpen(false);
                      try {
                        await api.patch(
                          `/api/subaccounts/${subaccountId}/Workflow-runs/${runId}/portal-visibility`,
                          { isPortalVisible: !run.isPortalVisible },
                        );
                        toast.success(
                          run.isPortalVisible
                            ? 'Hidden from portal'
                            : 'Published to portal',
                        );
                        await refresh();
                      } catch (err) {
                        toast.error(
                          (err as { response?: { data?: { error?: string } } })
                            ?.response?.data?.error ?? 'Failed to toggle portal visibility',
                        );
                      }
                    }}
                    className="flex-1 text-left bg-transparent border-0 cursor-pointer text-[13px] text-slate-800 p-0"
                  >
                    {run.isPortalVisible ? 'Hide from portal' : 'Show on portal'}
                  </button>
                  {/* §G5.4 — HelpHint on the portal-visibility toggle, one
                      of the three surfaces this spec creates. Explains what
                      "portal-visible" means for end-client viewers. */}
                  <HelpHint
                    text="When on, this run appears on the sub-account portal so your client can watch progress, approve steps, and see results. Turn off to keep an internal-only run."
                  />
                </div>
                {definition?.slug && (
                  <Link
                    role="menuitem"
                    to={`/system/Workflow-studio?slug=${encodeURIComponent(definition.slug)}`}
                    className="block w-full text-left px-3 py-2 hover:bg-slate-50 border-t border-slate-100"
                    onClick={() => setKebabOpen(false)}
                  >
                    Edit template in Studio
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
        {run.error && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {run.error}
            {run.failedDueToStepId && (
              <span className="text-red-600">
                {' — root cause: '}
                <code>{run.failedDueToStepId}</code>
              </span>
            )}
          </div>
        )}
      </header>

      {/* ── Body: left rail + right pane ─────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-[minmax(260px,320px)_1fr] gap-0 bg-slate-50">
        <aside className="border-r border-slate-200 bg-white overflow-y-auto">
          <div className="px-3 pt-4 pb-2 text-[11px] uppercase tracking-wider text-slate-400 font-medium">
            Steps
          </div>
          <ul className="pb-4">
            {orderedStepRuns.map((sr) => {
              const def = stepDefById.get(sr.stepId);
              const isSelected = sr.id === selectedStepRunId;
              const dot =
                STATUS_DOT_COLORS[sr.status] ?? STATUS_DOT_COLORS.pending;
              return (
                <li key={sr.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedStepRunId(sr.id)}
                    className={`w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-50 border-l-2 ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50/60'
                        : 'border-transparent'
                    }`}
                  >
                    <span
                      className={`mt-1 inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${dot}`}
                      aria-hidden="true"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-slate-800 truncate">
                        {def?.name ?? sr.stepId}
                      </span>
                      <span className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                        <span>{sr.stepType}</span>
                        <span
                          className={`${
                            SIDE_EFFECT_COLORS[sr.sideEffectType] ?? ''
                          } uppercase tracking-wide`}
                        >
                          {sr.sideEffectType}
                        </span>
                      </span>
                      <span className="block text-[11px] text-slate-400 mt-0.5">
                        {sr.status}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {orderedStepRuns.length === 0 && (
              <li className="px-4 py-3 text-xs text-slate-500">
                No steps dispatched yet.
              </li>
            )}
          </ul>
        </aside>
        <main className="overflow-y-auto relative pb-32">
          {selectedStep ? (
            <StepDetailPane
              stepRun={selectedStep}
              stepDef={stepDefById.get(selectedStep.stepId) ?? null}
            />
          ) : (
            <div className="p-6 text-sm text-slate-500">
              Select a step on the left to view its detail.
            </div>
          )}

          {/* HITL action bar — sticky footer, only when the selected step is
              awaiting review (awaiting_input or awaiting_approval). */}
          {selectedStep &&
            (selectedStep.status === 'awaiting_input' ||
              selectedStep.status === 'awaiting_approval') && (
              <div className="sticky bottom-0 left-0 right-0 border-t border-slate-200 bg-white/95 backdrop-blur px-6 py-4 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.15)]">
                {actionError && (
                  <div className="mb-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                    {actionError}
                  </div>
                )}
                {selectedStep.status === 'awaiting_input' && (
                  <div className="space-y-2">
                    {inputFormOpen ? (
                      <>
                        <p className="text-xs text-slate-500">
                          Provide form input as JSON matching the step&rsquo;s schema.
                        </p>
                        <textarea
                          value={inputFormData}
                          onChange={(e) => setInputFormData(e.target.value)}
                          className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs h-28"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              submitStepInput(selectedStep.id, selectedStep.version)
                            }
                            disabled={actionSubmitting}
                            className="px-3 py-1.5 text-sm rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            {actionSubmitting ? 'Submitting…' : 'Submit input'}
                          </button>
                          <button
                            onClick={() => {
                              setInputFormOpen(false);
                              setActionError(null);
                            }}
                            className="px-3 py-1.5 text-sm rounded border border-slate-300 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-slate-700">
                          This step is waiting for your input.
                        </p>
                        <button
                          onClick={() => {
                            setInputFormOpen(true);
                            setActionError(null);
                          }}
                          className="px-4 py-1.5 text-sm rounded bg-amber-500 text-white hover:bg-amber-600"
                        >
                          Provide input
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {selectedStep.status === 'awaiting_approval' && (
                  <div className="space-y-2">
                    {stepDefById.get(selectedStep.stepId)?.approvalPrompt && (
                      <p className="text-sm text-slate-700">
                        {stepDefById.get(selectedStep.stepId)!.approvalPrompt}
                      </p>
                    )}
                    {editApproveOpen ? (
                      <>
                        <p className="text-xs text-slate-500">
                          Edit the step&rsquo;s output (JSON) before approving. Tip: useful
                          when the agent is 90% right but needs a small correction.
                        </p>
                        <textarea
                          value={editApproveData}
                          onChange={(e) => setEditApproveData(e.target.value)}
                          className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs h-32"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              try {
                                const parsed = JSON.parse(editApproveData) as Record<
                                  string,
                                  unknown
                                >;
                                void decideApproval(
                                  selectedStep.id,
                                  selectedStep.version,
                                  'edited',
                                  parsed,
                                );
                              } catch {
                                setActionError('Edited output must be valid JSON.');
                              }
                            }}
                            disabled={actionSubmitting}
                            className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {actionSubmitting ? 'Submitting…' : 'Save & approve'}
                          </button>
                          <button
                            onClick={() => {
                              setEditApproveOpen(false);
                              setActionError(null);
                            }}
                            className="px-3 py-1.5 text-sm rounded border border-slate-300 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() =>
                            decideApproval(
                              selectedStep.id,
                              selectedStep.version,
                              'approved',
                            )
                          }
                          disabled={actionSubmitting}
                          className="px-4 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => {
                            setEditApproveData(
                              JSON.stringify(selectedStep.outputJson ?? {}, null, 2),
                            );
                            setEditApproveOpen(true);
                            setActionError(null);
                          }}
                          disabled={actionSubmitting}
                          className="px-4 py-1.5 text-sm rounded border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                          title="Edit the output before approving"
                        >
                          Approve &amp; edit
                        </button>
                        <button
                          onClick={() =>
                            decideApproval(
                              selectedStep.id,
                              selectedStep.version,
                              'rejected',
                            )
                          }
                          disabled={actionSubmitting}
                          className="px-4 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
        </main>
      </div>

      {/* ── Confirm dialogs ──────────────────────────────────────────────── */}
      {showCancelConfirm && (
        <ConfirmDialog
          title="Cancel run"
          message="Cancel this Workflow run? In-flight steps will settle before the run moves to cancelled."
          confirmLabel="Cancel run"
          onConfirm={handleCancelRun}
          onCancel={() => setShowCancelConfirm(false)}
        />
      )}
      {showReplayConfirm && (
        <ConfirmDialog
          title="Replay run"
          message="Start a fresh run using the same template version and inputs? Side-effecting steps marked irreversible will be skipped on replay."
          confirmLabel="Replay"
          onConfirm={handleReplayRun}
          onCancel={() => setShowReplayConfirm(false)}
        />
      )}
    </div>
  );
}

// ─── StepDetailPane ──────────────────────────────────────────────────────────

function formatDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = Math.max(0, end - start);
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
}

function StepDetailPane({
  stepRun,
  stepDef,
}: {
  stepRun: StepRun;
  stepDef: StepDef | null;
}) {
  const duration = formatDuration(stepRun.startedAt, stepRun.completedAt);
  return (
    <div className="p-6 space-y-5">
      <section>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">
            {stepDef?.name ?? stepRun.stepId}
          </h2>
          <span
            className={`px-2 py-0.5 rounded text-xs ${
              STATUS_COLORS[stepRun.status] ?? 'bg-slate-100 text-slate-700'
            }`}
          >
            {stepRun.status}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          <span className="font-mono">{stepRun.stepId}</span>
          {' · '}
          {stepRun.stepType}
          {' · '}
          <span
            className={`${
              SIDE_EFFECT_COLORS[stepRun.sideEffectType] ?? ''
            } uppercase tracking-wide`}
          >
            {stepRun.sideEffectType}
          </span>
          {stepRun.attempt > 1 && <> · attempt {stepRun.attempt}</>}
          {duration && <> · {duration}</>}
        </p>
        {stepDef?.description && (
          <p className="mt-3 text-sm text-slate-700">{stepDef.description}</p>
        )}
      </section>

      {stepRun.error && (
        <section>
          <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            Error
          </h3>
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 font-mono whitespace-pre-wrap break-words">
            {stepRun.error}
          </div>
        </section>
      )}

      {stepRun.dependsOn.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            Depends on
          </h3>
          <div className="flex flex-wrap gap-1">
            {stepRun.dependsOn.map((d) => (
              <code
                key={d}
                className="text-xs px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200"
              >
                {d}
              </code>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-1">
          Input
        </h3>
        {stepRun.inputJson ? (
          <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto max-h-60">
            {JSON.stringify(stepRun.inputJson, null, 2)}
          </pre>
        ) : (
          <p className="text-xs text-slate-400 italic">No input recorded yet.</p>
        )}
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-1">
          Output
        </h3>
        {stepRun.outputJson ? (
          <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto max-h-80">
            {JSON.stringify(stepRun.outputJson, null, 2)}
          </pre>
        ) : (
          <p className="text-xs text-slate-400 italic">
            No output yet — step is {stepRun.status}.
          </p>
        )}
      </section>
    </div>
  );
}
