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
    setExecuting(true);
    try {
      const res = await api.post(`/api/system/skill-analyser/jobs/${job.id}/execute`);
      onExecuted(res.data as ExecuteResult);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: unknown } }; message?: string };
      const errBody = e?.response?.data?.error;
      setError((typeof errBody === 'string' ? errBody : (errBody as { message?: string } | null)?.message) ?? e?.message ?? 'Execution failed.');
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
                {error}
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
                  onClick={() => setShowRestoreConfirm(true)}
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
