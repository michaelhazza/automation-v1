import { useState } from 'react';
import type { PulseItem } from '../../hooks/usePulseAttention';
import api from '../../lib/api';

interface MajorApprovalModalProps {
  item: PulseItem;
  onClose: () => void;
  onApproved: () => void;
}

export function MajorApprovalModal({ item, onClose, onApproved }: MajorApprovalModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/review-items/${item.id}/approve`, {
        majorAcknowledgment: true,
      });
      onApproved();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const resp = (err as { response?: { data?: { errorCode?: string; message?: string } } }).response;
        if (resp?.data?.errorCode === 'ALREADY_RESOLVED') {
          onApproved();
          return;
        }
        setError(resp?.data?.message || 'Approval failed');
      } else {
        setError('Approval failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-slate-800">Major Action Approval</h3>
        <p className="mt-2 text-sm text-slate-600">
          This action has been flagged as <strong>Major</strong> and requires explicit acknowledgment before approval.
        </p>

        {item.costSummary && (
          <div className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-800">
            Estimated cost: <strong>{item.costSummary}</strong>
          </div>
        )}

        <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={e => setAcknowledged(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-indigo-600 cursor-pointer shrink-0"
            />
            <span className="text-sm text-slate-700">
              {item.ackText || 'I understand and acknowledge this action.'}
            </span>
          </label>
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        )}

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleApprove}
            disabled={!acknowledged || submitting}
            className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Approving...' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}
