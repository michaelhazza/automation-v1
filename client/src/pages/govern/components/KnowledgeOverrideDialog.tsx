// client/src/pages/govern/components/KnowledgeOverrideDialog.tsx
// Edit-and-override dialog for knowledge entries.
// Spec: tasks/builds/consolidation-govern/spec.md §4.12, §4.13 (override confirmation copy)

import { useState } from 'react';
import Modal from '../../../components/Modal';
import { overrideKnowledge } from '../../../api/governApi';
import type { KnowledgeEntry } from '../../../../../shared/types/govern.js';

interface Props {
  entry: KnowledgeEntry;
  onClose: () => void;
  onSaved: () => void;
}

export function KnowledgeOverrideDialog({ entry, onClose, onSaved }: Props) {
  const [body, setBody] = useState(entry.body);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const result = await overrideKnowledge(entry.id, body, entry.etag);
      if ('error' in result) {
        if (result.error === 'invalid_state_transition') {
          // HTTP 409 — entry is not in 'in_use' state
          setErrorMsg("Entry is not in 'in use' state and cannot be overridden.");
        } else if (result.error === 'etag_mismatch') {
          // HTTP 412 — concurrent modification
          setErrorMsg('This entry was modified by someone else. Please refresh and try again.');
        }
      } else {
        onSaved();
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'An unexpected error occurred.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Edit and override"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !body.trim()}
            onClick={handleSave}
            className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Saving...' : 'Save override'}
          </button>
        </div>
      }
    >
      {/* Spec §4.13 override confirmation copy */}
      <p className="text-sm text-slate-600 mb-4">
        This will update the entry and lock it from automatic updates. The override will be saved as a new version. Are you sure?
      </p>

      <label className="block text-xs font-medium text-slate-700 mb-1">
        New body
      </label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={6}
        className="w-full text-sm border border-slate-200 rounded-lg p-3 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        placeholder="Enter the corrected knowledge entry..."
      />

      {errorMsg && (
        <p className="mt-2 text-xs text-red-600">{errorMsg}</p>
      )}
    </Modal>
  );
}
