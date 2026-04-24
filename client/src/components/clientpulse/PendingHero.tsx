import { useState } from 'react';

interface PendingHeroProps {
  pendingIntervention: {
    reviewItemId: string;
    actionTitle: string;
    proposedAt: string;      // ISO 8601
    rationale: string;
  } | null;
  onApprove: (reviewItemId: string) => Promise<void>;
  onReject: (reviewItemId: string) => Promise<void>;
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

  const handleReject = async () => {
    const id = pendingIntervention?.reviewItemId;
    if (!id || isDisabled) return;
    setIsSubmitting(true);
    try {
      await onReject(id);
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
        <button
          onClick={handleReject}
          disabled={isDisabled}
          className="rounded px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

export default PendingHero;
