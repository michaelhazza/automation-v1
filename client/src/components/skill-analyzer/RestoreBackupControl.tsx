import { useState } from 'react';
import api from '../../lib/api';

export interface RestoreResult {
  skillsReverted: number;
  skillsDeactivated: number;
  agentsReverted: number;
  agentsSoftDeleted: number;
}

/** Final outcome of a restore attempt — lifted up to the Wizard so the
 *  banner persists across the parent's backup-status transition (active →
 *  restored). Once `onOutcome` fires the parent stops rendering this control
 *  entirely; the outcome banner lives on the step component, not here. */
export type RestoreOutcome =
  | { status: 'success'; counts: RestoreResult }
  | { status: 'alreadyRestored' };

interface Props {
  jobId: string;
  onOutcome: (outcome: RestoreOutcome) => void;
  /** Optional visual variant — "header" is compact for toolbar placement,
   *  "inline" matches the execute-step action row. */
  variant?: 'header' | 'inline';
}

function extractMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: unknown } }; message?: string };
  const errBody = e?.response?.data?.error;
  return (typeof errBody === 'string' ? errBody : (errBody as { message?: string } | null)?.message)
    ?? e?.message ?? fallback;
}

export default function RestoreBackupControl({ jobId, onOutcome, variant = 'inline' }: Props) {
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [preview, setPreview] = useState<RestoreResult | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpenConfirm() {
    setError(null);
    setDryRunLoading(true);
    try {
      const res = await api.post<RestoreResult>(
        `/api/system/skill-analyser/jobs/${jobId}/restore?dryRun=true`,
      );
      setPreview(res.data);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        onOutcome({ status: 'alreadyRestored' });
      } else {
        setError(extractMessage(err, 'Failed to preview revert.'));
      }
    } finally {
      setDryRunLoading(false);
    }
  }

  async function handleConfirm() {
    setError(null);
    setRestoring(true);
    try {
      const res = await api.post<RestoreResult>(
        `/api/system/skill-analyser/jobs/${jobId}/restore`,
      );
      setPreview(null);
      onOutcome({ status: 'success', counts: res.data });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setPreview(null);
        onOutcome({ status: 'alreadyRestored' });
      } else {
        setError(extractMessage(err, 'Restore failed.'));
      }
    } finally {
      setRestoring(false);
    }
  }

  const buttonClass = variant === 'header'
    ? 'px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-300 bg-white text-amber-700 hover:bg-amber-50 disabled:opacity-50 transition-colors'
    : 'px-4 py-2.5 bg-white text-amber-700 text-sm font-medium border border-amber-300 rounded-lg hover:bg-amber-50 disabled:opacity-50 transition-colors';

  const showButton = !preview;

  return (
    <div>
      {showButton && (
        <button
          type="button"
          onClick={handleOpenConfirm}
          disabled={dryRunLoading}
          className={buttonClass}
        >
          {dryRunLoading ? 'Checking…' : 'Revert previous execution'}
        </button>
      )}

      {preview && (
        <div className="mt-3 p-4 bg-amber-50 border border-amber-300 rounded-lg">
          <p className="text-sm font-medium text-amber-900 mb-2">Revert previous execution?</p>
          {preview.skillsReverted === 0
            && preview.skillsDeactivated === 0
            && preview.agentsReverted === 0
            && preview.agentsSoftDeleted === 0 ? (
            <p className="text-xs text-amber-700 mb-3">
              This backup would not change anything currently — nothing to revert.
            </p>
          ) : (
            <ul className="text-xs text-amber-800 mb-3 space-y-0.5">
              <li>Skills reverted: <strong>{preview.skillsReverted}</strong></li>
              <li>Skills deactivated: <strong>{preview.skillsDeactivated}</strong></li>
              <li>Agents reverted: <strong>{preview.agentsReverted}</strong></li>
              <li>Agents soft-deleted: <strong>{preview.agentsSoftDeleted}</strong></li>
            </ul>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={restoring}
              className="px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              {restoring ? 'Reverting…' : 'Confirm Revert'}
            </button>
            <button
              type="button"
              onClick={() => { setPreview(null); setError(null); }}
              disabled={restoring}
              className="px-3 py-1.5 bg-white text-slate-700 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
