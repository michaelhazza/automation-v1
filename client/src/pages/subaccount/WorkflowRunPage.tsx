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
 *   - Baseline: GET /api/subaccounts/:id/workflow-runs/:runId/envelope
 *   - Live updates: WS room `Workflow-run:${runId}` with full refresh on event
 *   - Fallback: 12s polling while disconnected AND run.status === 'running'
 *     (stops at terminal status per spec §9.2)
 *
 * Three surfaces / one run object (§9.1): this page is the authoritative
 * timeline for both admin and sub-account viewers. Portal-card and
 * onboarding-tab surfaces render elsewhere.
 */

import React, { useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../../lib/api';
import type { User } from '../../lib/auth';
import type { StepRun, StepDef } from '../../components/workflow-run/types';
import { useWorkflowRunEnvelope } from '../../hooks/useWorkflowRunEnvelope';
import StepDetailPane from '../../components/workflow-run/StepDetailPane';
import RunHeader from '../../components/workflow-run/RunHeader';
import StepDag from '../../components/workflow-run/StepDag';
import HitlActionBar from '../../components/workflow-run/HitlActionBar';

// ─── Component ───────────────────────────────────────────────────────────────

export default function WorkflowRunPage(_props: { user: User }) {
  const { subaccountId, runId } = useParams<{ subaccountId: string; runId: string }>();
  const navigate = useNavigate();

  const {
    envelope: data,
    loading,
    error,
    refetch: refresh,
    socketConnected: wsConnected,
    selectedStepRunId,
    setSelectedStepRunId,
  } = useWorkflowRunEnvelope(subaccountId, runId);

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

  async function handleCancelRun() {
    try {
      await api.post(`/api/workflow-runs/${runId}/cancel`);
      toast.success('Cancellation requested');
      await refresh();
    } catch (err) {
      toast.error(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Failed to cancel run',
      );
    }
  }

  async function handleReplayRun() {
    try {
      const res = await api.post(`/api/workflow-runs/${runId}/replay`);
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
    }
  }

  async function handlePortalToggle() {
    try {
      if (!data) return;
      await api.patch(
        `/api/subaccounts/${subaccountId}/workflow-runs/${runId}/portal-visibility`,
        { isPortalVisible: !data.run.isPortalVisible },
      );
      toast.success(
        data.run.isPortalVisible
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

  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)]">
      <RunHeader
        run={run}
        definition={definition}
        stepRuns={data.stepRuns}
        socketConnected={wsConnected}
        subaccountId={subaccountId!}
        onCancel={handleCancelRun}
        onReplay={handleReplayRun}
        onPortalToggle={handlePortalToggle}
      />

      {/* ── Body: left rail + right pane ─────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-[minmax(260px,320px)_1fr] gap-0 bg-slate-50">
        <StepDag
          stepRuns={orderedStepRuns}
          stepDefById={stepDefById}
          selectedStepRunId={selectedStepRunId}
          onSelectStepRun={setSelectedStepRunId}
        />
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
              <HitlActionBar
                stepRun={selectedStep}
                stepDef={stepDefById.get(selectedStep.stepId) ?? null}
                runId={runId!}
                onActionTaken={refresh}
              />
            )}
        </main>
      </div>

    </div>
  );
}
