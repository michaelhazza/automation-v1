import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import type { AnalysisJob, AnalysisResult, BackupMetadata } from './SkillAnalyzerWizard';
import RestoreBackupControl, { type RestoreOutcome } from './RestoreBackupControl';
import RestoreOutcomeBanner from './RestoreOutcomeBanner';

interface ExecuteResult {
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ resultId: string; error: string }>;
  backupId: string | null;
}

interface Props {
  job: AnalysisJob;
  results: AnalysisResult[];
  onExecuted: (result: ExecuteResult) => void;
  executeResult: ExecuteResult | null;
  onStartNew: () => void;
  backup: BackupMetadata | null;
  onRestoreOutcome: (outcome: RestoreOutcome) => void;
  restoreOutcome: RestoreOutcome | null;
  onDismissRestoreOutcome: () => void;
}

export default function SkillAnalyzerExecuteStep({ job, results, onExecuted, executeResult, onStartNew, backup, onRestoreOutcome, restoreOutcome, onDismissRestoreOutcome }: Props) {
  const navigate = useNavigate();
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const canRestore = backup?.status === 'active';

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-4">Execute Approved Actions</h2>

        {restoreOutcome && (
          <div className="mb-4">
            <RestoreOutcomeBanner outcome={restoreOutcome} onDismiss={onDismissRestoreOutcome} />
          </div>
        )}

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

            {canRestore && (
              <div className="mb-4">
                <RestoreBackupControl jobId={job.id} onOutcome={onRestoreOutcome} variant="inline" />
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

            {canRestore && (
              <div className="mb-4">
                <RestoreBackupControl jobId={job.id} onOutcome={onRestoreOutcome} variant="inline" />
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}
