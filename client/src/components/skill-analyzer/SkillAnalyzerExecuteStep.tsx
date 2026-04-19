import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import type { AnalysisJob, AnalysisResult } from './SkillAnalyzerWizard';

interface ExecuteResult {
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ resultId: string; error: string }>;
  backupId: string | null;
  // v2 Fix 5: proposed agents whose skill attachments all failed — stay as
  // drafts. Surfaced here so admins can review/promote manually.
  pendingDraftAgents?: Array<{ agentId: string; slug: string; name: string }>;
}

/** Shape of a structured blocking reason returned by the server when
 *  POST /execute hits the evaluateApprovalState gate. Mirrors
 *  `ApprovalBlockingReason` in server/services/skillAnalyzerServicePure.ts.
 *  Spec §11.1. */
interface BlockingReason {
  warningCode: string;
  tier: string;
  message: string;
  field?: string;
}

interface RestoreResult {
  skillsReverted: number;
  skillsDeactivated: number;
  agentsReverted: number;
}

interface Props {
  job: AnalysisJob;
  results: AnalysisResult[];
  onExecuted: (result: ExecuteResult) => void;
  executeResult: ExecuteResult | null;
  onStartNew: () => void;
}

export default function SkillAnalyzerExecuteStep({ job, results, onExecuted, executeResult, onStartNew }: Props) {
  const navigate = useNavigate();
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // v2 §11.1: structured reasons[] payload returned with 409 responses when
  // the server's evaluateApprovalState re-check rejects the run. Rendered as
  // a per-result blocking list so reviewers know exactly what to fix. The
  // server also returns the top-level `resultId` so the UI can pinpoint
  // which row is blocking.
  const [blockingReasons, setBlockingReasons] = useState<BlockingReason[] | null>(null);
  const [blockingResultId, setBlockingResultId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);

  const approved = results.filter((r) => r.actionTaken === 'approved');
  const rejected = results.filter((r) => r.actionTaken === 'rejected' || r.actionTaken === 'skipped');
  const unanswered = results.filter((r) => r.actionTaken == null);

  const toCreate = approved.filter((r) => r.classification === 'DISTINCT' || r.classification === 'PARTIAL_OVERLAP').length;
  const toUpdate = approved.filter((r) => r.classification === 'IMPROVEMENT').length;
  const toSkip = approved.filter((r) => r.classification === 'DUPLICATE').length + rejected.length;

  async function handleExecute() {
    setError(null);
    setBlockingReasons(null);
    setBlockingResultId(null);
    setExecuting(true);
    try {
      const res = await api.post(`/api/system/skill-analyser/jobs/${job.id}/execute`);
      onExecuted(res.data as ExecuteResult);
    } catch (err: unknown) {
      const e = err as {
        response?: {
          status?: number;
          data?: {
            error?: unknown;
            reasons?: BlockingReason[];
            resultId?: string;
          };
        };
        message?: string;
      };
      const data = e?.response?.data;
      const errBody = data?.error;
      // 409 MERGE_CRITICAL_WARNINGS carries a structured reasons[] array so
      // the UI can render a per-result blocking list. Fall back to the plain
      // error message for every other failure mode.
      if (e?.response?.status === 409 && Array.isArray(data?.reasons) && data!.reasons!.length > 0) {
        setBlockingReasons(data!.reasons!);
        if (typeof data!.resultId === 'string') setBlockingResultId(data!.resultId);
      }
      setError(
        (typeof errBody === 'string' ? errBody : (errBody as { message?: string } | null)?.message)
          ?? e?.message
          ?? 'Execution failed.',
      );
    } finally {
      setExecuting(false);
    }
  }

  async function handleRestore() {
    setRestoreError(null);
    setRestoring(true);
    try {
      const res = await api.post(`/api/system/skill-analyser/jobs/${job.id}/restore`);
      setRestoreResult(res.data as RestoreResult);
      setShowRestoreConfirm(false);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: unknown } }; message?: string };
      const errBody = e?.response?.data?.error;
      setRestoreError(
        (typeof errBody === 'string' ? errBody : (errBody as { message?: string } | null)?.message)
          ?? e?.message ?? 'Restore failed.',
      );
    } finally {
      setRestoring(false);
    }
  }

  const hasChanges = executeResult && (executeResult.created > 0 || executeResult.updated > 0);
  const canRestore = hasChanges && executeResult.backupId && !restoreResult;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-4">Execute Approved Actions</h2>

        {!executeResult ? (
          <>
            {/* Summary */}
            <div className="space-y-3 mb-6">
              {toCreate > 0 && (
                <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <span className="text-green-700 text-sm font-semibold">{toCreate}</span>
                  <span className="text-sm text-green-700">
                    skill{toCreate === 1 ? '' : 's'} to create (DISTINCT + PARTIAL_OVERLAP approved)
                  </span>
                </div>
              )}
              {toUpdate > 0 && (
                <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <span className="text-blue-700 text-sm font-semibold">{toUpdate}</span>
                  <span className="text-sm text-blue-700">
                    skill{toUpdate === 1 ? '' : 's'} to update (IMPROVEMENT approved)
                  </span>
                </div>
              )}
              {toSkip > 0 && (
                <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <span className="text-slate-600 text-sm font-semibold">{toSkip}</span>
                  <span className="text-sm text-slate-600">
                    skill{toSkip === 1 ? '' : 's'} to skip (DUPLICATE approved or rejected)
                  </span>
                </div>
              )}
              {unanswered.length > 0 && (
                <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <span className="text-amber-700 text-sm font-semibold">{unanswered.length}</span>
                  <span className="text-sm text-amber-700">
                    result{unanswered.length === 1 ? '' : 's'} with no action — will be skipped
                  </span>
                </div>
              )}
              {approved.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-4">
                  No approved actions. Go back and approve results to execute them.
                </p>
              )}
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <p className="font-medium mb-1">{error}</p>
                {blockingReasons && (
                  <>
                    {blockingResultId && (
                      <p className="text-xs text-red-600 mt-1">
                        Blocking result: <span className="font-mono">{blockingResultId}</span>
                      </p>
                    )}
                    <ul className="mt-2 space-y-1 text-xs">
                      {blockingReasons.map((r) => (
                        <li key={`${r.warningCode}:${r.field ?? ''}`} className="flex gap-2">
                          <span className="font-mono text-red-800">{r.warningCode}</span>
                          <span className="text-red-600">({r.tier})</span>
                          {r.field && <span className="text-red-600">[{r.field}]</span>}
                          <span className="text-red-600">— {r.message}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleExecute}
                disabled={executing || approved.length === 0}
                className="flex-1 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {executing ? 'Executing...' : 'Execute'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Execution results */}
            <div className="space-y-3 mb-6">
              {executeResult.created > 0 && (
                <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <span className="text-green-700 text-sm">
                    Created <strong>{executeResult.created}</strong> skill{executeResult.created === 1 ? '' : 's'}
                  </span>
                </div>
              )}
              {executeResult.updated > 0 && (
                <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <span className="text-blue-700 text-sm">
                    Updated <strong>{executeResult.updated}</strong> skill{executeResult.updated === 1 ? '' : 's'}
                  </span>
                </div>
              )}
              {executeResult.failed > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-700 text-sm font-medium mb-2">
                    {executeResult.failed} skill{executeResult.failed === 1 ? '' : 's'} failed
                  </p>
                  {executeResult.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-600">{e.error}</p>
                  ))}
                </div>
              )}
              {executeResult.pendingDraftAgents && executeResult.pendingDraftAgents.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-amber-800 text-sm font-medium mb-1">
                    {executeResult.pendingDraftAgents.length} proposed agent{executeResult.pendingDraftAgents.length === 1 ? '' : 's'} left in draft
                  </p>
                  <p className="text-xs text-amber-700 mb-2">
                    Skill attachments failed for these agents. Review and promote manually.
                  </p>
                  <ul className="space-y-0.5 text-xs">
                    {executeResult.pendingDraftAgents.map((a) => (
                      <li key={a.agentId} className="text-amber-800">
                        <span className="font-medium">{a.name}</span> <span className="text-amber-600">({a.slug})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {executeResult.created === 0 && executeResult.updated === 0 && executeResult.failed === 0 && (
                <p className="text-sm text-slate-500 text-center py-2">No changes were made.</p>
              )}
            </div>

            {/* Restore result */}
            {restoreResult && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm font-medium text-amber-800 mb-1">Changes reverted</p>
                <p className="text-xs text-amber-700">
                  {restoreResult.skillsReverted > 0 && `${restoreResult.skillsReverted} skill${restoreResult.skillsReverted === 1 ? '' : 's'} reverted. `}
                  {restoreResult.skillsDeactivated > 0 && `${restoreResult.skillsDeactivated} new skill${restoreResult.skillsDeactivated === 1 ? '' : 's'} deactivated. `}
                  {restoreResult.agentsReverted > 0 && `${restoreResult.agentsReverted} agent${restoreResult.agentsReverted === 1 ? '' : 's'} reverted.`}
                  {restoreResult.skillsReverted === 0 && restoreResult.skillsDeactivated === 0 && restoreResult.agentsReverted === 0 && 'No changes needed.'}
                </p>
              </div>
            )}

            {/* Restore error */}
            {restoreError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {restoreError}
              </div>
            )}

            {/* Restore confirmation dialog */}
            {showRestoreConfirm && (
              <div className="mb-4 p-4 bg-amber-50 border border-amber-300 rounded-lg">
                <p className="text-sm font-medium text-amber-900 mb-2">Revert all changes?</p>
                <p className="text-xs text-amber-700 mb-3">
                  This will undo all changes made by this skill analyser run.
                  Skills created will be deactivated, and updated skills and agent
                  assignments will be reverted to their pre-execution state.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleRestore}
                    disabled={restoring}
                    className="px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
                  >
                    {restoring ? 'Reverting...' : 'Confirm Revert'}
                  </button>
                  <button
                    onClick={() => setShowRestoreConfirm(false)}
                    disabled={restoring}
                    className="px-3 py-1.5 bg-white text-slate-700 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => navigate('/system/skills')}
                className="flex-1 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Return to Skills
              </button>
              <button
                onClick={onStartNew}
                className="px-4 py-2.5 bg-white text-slate-700 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                New Analysis
              </button>
              {canRestore && !showRestoreConfirm && (
                <button
                  onClick={() => { setRestoreError(null); setShowRestoreConfirm(true); }}
                  className="px-4 py-2.5 bg-white text-amber-700 text-sm font-medium border border-amber-300 rounded-lg hover:bg-amber-50 transition-colors"
                >
                  Revert Changes
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
