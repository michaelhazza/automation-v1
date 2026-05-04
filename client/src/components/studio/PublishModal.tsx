/**
 * PublishModal — optional notes + concurrent-edit warning before publishing.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/plan.md Chunk 14a.
 */

import React, { useState, useEffect } from 'react';

interface ConcurrentEditInfo {
  updatedAt: string;
  userId: string;
}

interface PublishModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (notes: string, force: boolean) => void;
  concurrentEditUpstream?: ConcurrentEditInfo | null;
  publishing?: boolean;
}

export default function PublishModal({
  open,
  onClose,
  onConfirm,
  concurrentEditUpstream,
  publishing,
}: PublishModalProps) {
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setSubmitting(false);
      setNotes('');
    }
  }, [open]);

  if (!open) return null;

  const hasConcurrentEdit = !!concurrentEditUpstream;

  function handleConfirm(force: boolean) {
    if (submitting) return;
    setSubmitting(true);
    onConfirm(notes, force);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-modal-title"
    >
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl p-6">
        <h2 id="publish-modal-title" className="text-base font-semibold text-slate-800 mb-4">
          Publish workflow
        </h2>

        {hasConcurrentEdit && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This template was published by another user since you opened it. Publishing now will
            overwrite their changes.
          </div>
        )}

        <div className="mb-4">
          <label
            htmlFor="publish-notes"
            className="block text-sm font-medium text-slate-700 mb-1"
          >
            Publish notes (optional)
          </label>
          <textarea
            id="publish-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Describe what changed in this version..."
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting || publishing}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          {hasConcurrentEdit ? (
            <button
              type="button"
              onClick={() => handleConfirm(true)}
              disabled={submitting || publishing}
              className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              {submitting || publishing ? 'Publishing...' : 'Publish anyway'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleConfirm(false)}
              disabled={submitting || publishing}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {submitting || publishing ? 'Publishing...' : 'Publish'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
