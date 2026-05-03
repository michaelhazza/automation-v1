/**
 * PublishModal — publish notes entry + concurrent-edit confirmation.
 *
 * Spec: tasks/Workflows-spec.md §10.4, §10.5.
 *
 * Happy path:
 *   1. User clicks Publish in StudioBottomBar.
 *   2. Modal opens with optional publishNotes textarea.
 *   3. On confirm: POST /api/admin/workflows/:id/publish
 *   4. 200 ok: close modal, parent shows success.
 *   5. 422 validation_failed: render error pills back on the canvas via onValidationErrors.
 *   6. 409 concurrent_publish: show override banner; user can publish-anyway or cancel.
 */

import React, { useState } from 'react';
import api from '../../lib/api.js';
import type { ValidatorError } from '../../../../shared/types/workflowValidator.js';
import type { CanvasStep } from './studioCanvasPure.js';

// ─── API response shapes ──────────────────────────────────────────────────────

interface PublishOkResponse {
  version_id: string;
  version_number: number;
}

interface PublishValidationFailedResponse {
  error: 'validation_failed';
  errors: ValidatorError[];
}

interface PublishConcurrentResponse {
  error: 'concurrent_publish';
  upstream_updated_at: string;
  upstream_user_id: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PublishModalProps {
  templateId: string;
  steps: CanvasStep[];
  /** ISO 8601 timestamp from when the canvas was opened. Sent for concurrent-edit detection. */
  expectedUpstreamUpdatedAt: string | undefined;
  onClose: () => void;
  onSuccess: (versionId: string, versionNumber: number) => void;
  /** Called with per-step errors when the server returns 422. Parent renders pills. */
  onValidationErrors: (errorsByStepId: Map<string, ValidatorError[]>) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PublishModal({
  templateId,
  steps,
  expectedUpstreamUpdatedAt,
  onClose,
  onSuccess,
  onValidationErrors,
}: PublishModalProps) {
  const [publishNotes, setPublishNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [concurrentConflict, setConcurrentConflict] = useState<{
    upstreamUpdatedAt: string;
    upstreamUserId: string;
  } | null>(null);

  async function doPublish(overrideConcurrent: boolean) {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        steps,
        publishNotes: publishNotes.trim() || undefined,
      };
      if (!overrideConcurrent && expectedUpstreamUpdatedAt) {
        body.expectedUpstreamUpdatedAt = expectedUpstreamUpdatedAt;
      }

      const res = await api.post<PublishOkResponse>(
        `/api/admin/workflows/${templateId}/publish`,
        body
      );
      onSuccess(res.data.version_id, res.data.version_number);
      onClose();
    } catch (err: unknown) {
      const data = (err as { response?: { status?: number; data?: unknown } })?.response;
      const status = data?.status;
      const body = data?.data;

      if (status === 409) {
        const r = body as PublishConcurrentResponse;
        setConcurrentConflict({
          upstreamUpdatedAt: r.upstream_updated_at,
          upstreamUserId: r.upstream_user_id,
        });
        setBusy(false);
        return;
      }

      if (status === 422) {
        const r = body as PublishValidationFailedResponse;
        // Bucket errors by step id for inline rendering on the canvas.
        const byStep = new Map<string, ValidatorError[]>();
        for (const e of r.errors ?? []) {
          const key = e.stepId ?? '__workflow__';
          const existing = byStep.get(key) ?? [];
          existing.push(e);
          byStep.set(key, existing);
        }
        onValidationErrors(byStep);
        onClose();
        return;
      }

      setError(
        err instanceof Error
          ? err.message
          : typeof body === 'object' && body !== null && 'message' in body
          ? String((body as { message: string }).message)
          : 'Publish failed'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Publish workflow</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Publish a new immutable version. In-flight runs are not affected.
          </p>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Concurrent edit conflict banner */}
          {concurrentConflict && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <div className="font-semibold mb-1">Conflict: workflow edited since you opened it</div>
              <div className="text-xs mb-2">
                Updated at {new Date(concurrentConflict.upstreamUpdatedAt).toLocaleString()}.
                Publishing anyway will overwrite those changes.
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => doPublish(true)}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Publish anyway
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {/* Publish notes */}
          {!concurrentConflict && (
            <div>
              <label
                htmlFor="publish-notes"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Release notes
                <span className="text-slate-400 font-normal ml-1">(optional)</span>
              </label>
              <textarea
                id="publish-notes"
                value={publishNotes}
                onChange={(e) => setPublishNotes(e.target.value)}
                rows={3}
                placeholder="Describe what changed in this version..."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>
          )}
        </div>

        {!concurrentConflict && (
          <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-1.5 text-sm rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => doPublish(false)}
              disabled={busy}
              className="px-4 py-1.5 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? 'Publishing...' : 'Publish'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
