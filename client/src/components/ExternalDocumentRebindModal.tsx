import { useState } from 'react';
import { rebindExternalReference } from '../api/externalDocumentReferences';
import type { ExternalDocumentReference } from '../api/externalDocumentReferences';

interface Props {
  subaccountId: string;
  taskId: string;
  reference: ExternalDocumentReference;
  connections: Array<{ id: string; label?: string | null; ownerEmail?: string | null }>;
  isOpen: boolean;
  onClose: () => void;
  onRebound: (updated: ExternalDocumentReference) => void;
  onRemove: () => void;
}

export function ExternalDocumentRebindModal({ subaccountId, taskId, reference, connections, isOpen, onClose, onRebound, onRemove }: Props) {
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!isOpen) return null;

  const canConfirm = !!selectedConnId && !submitting;

  const handleConfirm = async () => {
    if (!selectedConnId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const updated = await rebindExternalReference(subaccountId, taskId, reference.id, selectedConnId);
      onRebound(updated);
      onClose();
    } catch (err: unknown) {
      const reason = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'unknown';
      setSubmitError(reason);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <header className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-base font-semibold">Re-attach broken reference</h2>
          <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-slate-700 text-xl leading-none">×</button>
        </header>
        <div className="space-y-4 p-5">
          <div>
            <p className="text-sm text-slate-700 font-medium">{reference.name}</p>
            <p className="mt-1 text-xs text-slate-500">{plainEnglishFailureReason(reference.failureReason)}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Choose a connection</label>
            <select
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={selectedConnId ?? ''}
              onChange={e => setSelectedConnId(e.target.value || null)}
            >
              <option value="">Select a Google Drive connection…</option>
              {connections.map(c => (
                <option key={c.id} value={c.id}>{c.label ?? `Drive (${c.ownerEmail ?? c.id.slice(0, 6)})`}</option>
              ))}
            </select>
          </div>
          {submitError && (
            <p className="text-sm text-red-700">Could not re-attach: {submitError}. Try another connection.</p>
          )}
        </div>
        <footer className="flex items-center justify-between border-t bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={() => { onRemove(); onClose(); }}
            className="text-sm text-red-600 hover:text-red-800 underline"
          >
            Remove reference instead
          </button>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">
              Cancel
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={handleConfirm}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50 hover:bg-blue-700"
            >
              {submitting ? 'Re-attaching…' : 'Re-attach'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function plainEnglishFailureReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'auth_revoked': return 'The connection no longer has access to this file.';
    case 'file_deleted': return 'This file was deleted from Drive.';
    case 'rate_limited': return 'Drive temporarily rate-limited; the file is unavailable.';
    default: return 'The file could not be fetched.';
  }
}
