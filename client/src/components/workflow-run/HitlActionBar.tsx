import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '../../lib/api';
import type { StepRun, StepDef } from './types';

interface HitlActionBarProps {
  stepRun: StepRun;
  stepDef: StepDef | null;
  runId: string;
  onActionTaken(): Promise<void>;
}

export default function HitlActionBar({
  stepRun,
  stepDef,
  runId,
  onActionTaken,
}: HitlActionBarProps) {
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
  }, [stepRun.id]);

  async function submitStepInput(stepRunId: string, expectedVersion: number) {
    setActionSubmitting(true);
    setActionError(null);
    try {
      const parsed = JSON.parse(inputFormData);
      await api.post(
        `/api/workflow-runs/${runId}/steps/${stepRunId}/input`,
        { data: parsed, expectedVersion },
      );
      setInputFormOpen(false);
      setInputFormData('{\n  \n}');
      toast.success('Input submitted');
      await onActionTaken();
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
        `/api/workflow-runs/${runId}/steps/${stepRunId}/approve`,
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
      await onActionTaken();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err instanceof Error ? err.message : 'Failed to submit decision');
      setActionError(msg);
    } finally {
      setActionSubmitting(false);
    }
  }

  return (
    <div className="sticky bottom-0 left-0 right-0 border-t border-slate-200 bg-white/95 backdrop-blur px-6 py-4 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.15)]">
      {actionError && (
        <div className="mb-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {actionError}
        </div>
      )}
      {stepRun.status === 'awaiting_input' && (
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
                  onClick={() => submitStepInput(stepRun.id, stepRun.version)}
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

      {stepRun.status === 'awaiting_approval' && (
        <div className="space-y-2">
          {stepDef?.approvalPrompt && (
            <p className="text-sm text-slate-700">{stepDef.approvalPrompt}</p>
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
                        stepRun.id,
                        stepRun.version,
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
                  decideApproval(stepRun.id, stepRun.version, 'approved')
                }
                disabled={actionSubmitting}
                className="px-4 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                onClick={() => {
                  setEditApproveData(
                    JSON.stringify(stepRun.outputJson ?? {}, null, 2),
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
                  decideApproval(stepRun.id, stepRun.version, 'rejected')
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
  );
}
