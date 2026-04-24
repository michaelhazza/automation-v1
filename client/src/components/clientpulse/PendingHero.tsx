import { useState } from 'react';

interface PendingHeroProps {
  pendingIntervention: {
    reviewItemId: string;
    actionTitle: string;
    proposedAt: string;      // ISO 8601
    rationale: string;
  } | null;
  onApprove: (reviewItemId: string) => Promise<void>;
  onReject: (reviewItemId: string, comment: string) => Promise<void>;
  conflict?: boolean;
  error?: string | null;
}

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const proposed = new Date(isoString).getTime();
  const diffMs = now - proposed;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

export function PendingHero({
  pendingIntervention,
  onApprove,
  onReject,
  conflict = false,
  error = null,
}: PendingHeroProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectComment, setRejectComment] = useState('');

  if (!pendingIntervention) return null;

  const { actionTitle, proposedAt, rationale } = pendingIntervention;
  const isDisabled = isSubmitting || conflict;

  const handleApprove = async () => {
    const id = pendingIntervention?.reviewItemId;
    if (!id || isDisabled) return;
    setIsSubmitting(true);
    try {
      await onApprove(id);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitReject = async () => {
    const id = pendingIntervention?.reviewItemId;
    if (!id || isDisabled || rejectComment.trim() === '') return;
    setIsSubmitting(true);
    try {
      await onReject(id, rejectComment);
      setShowRejectInput(false);
      setRejectComment('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p className="font-semibold text-slate-800 text-sm">{actionTitle}</p>
      <p className="text-slate-600 text-sm mt-1">{rationale}</p>
      <p className="text-slate-400 text-xs mt-1">{formatRelativeTime(proposedAt)}</p>
      {error && <p className="text-rose-600 text-xs mt-2">{error}</p>}
      {conflict && (
        <p className="text-amber-700 text-xs mt-2 font-medium">
          This item was already updated.
        </p>
      )}
      <div className="flex gap-2 mt-3">
        <button
          onClick={handleApprove}
          disabled={isDisabled}
          className="rounded px-3 py-1.5 bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          Approve
        </button>
        {!showRejectInput && (
          <button
            onClick={() => setShowRejectInput(true)}
            disabled={isDisabled}
            className="rounded px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            Reject
          </button>
        )}
      </div>
      {showRejectInput && (
        <div>
          <textarea
            rows={2}
            className="mt-2 w-full rounded border border-slate-200 p-2 text-[13px] text-slate-700 resize-none"
            placeholder="Reason for rejection"
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
          />
          <button
            onClick={handleSubmitReject}
            disabled={rejectComment.trim() === '' || isSubmitting}
            className="mt-1 rounded px-3 py-1.5 bg-rose-600 text-white text-[13px] font-medium hover:bg-rose-700 disabled:opacity-50"
          >
            Submit rejection
          </button>
          <button
            onClick={() => { setShowRejectInput(false); setRejectComment(''); }}
            className="mt-1 ml-2 text-[12px] text-slate-500 hover:underline"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default PendingHero;
