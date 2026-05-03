/**
 * ApprovalCard — approval gate card rendered in the Chat pane.
 *
 * Shows the seen-confidence chip, an audit caption, and Approve/Reject buttons.
 * POSTs to /api/gates/:gateId/decide.
 *
 * Spec: docs/workflows-dev-spec.md §9.2, §6.
 */

import { useState } from 'react';
import api from '../../lib/api.js';
import type { SeenConfidence } from '../../../../shared/types/taskEvent.js';

type ConfidenceLevel = 'high' | 'medium' | 'low';

interface ApprovalCardProps {
  gateId: string;
  stepId: string;
  seenConfidence: SeenConfidence;
  approverPool: string[];
  /** ID of the current user — used to check whether this user is an approver. */
  currentUserId: string;
  onDecided?: (decision: 'approved' | 'rejected') => void;
}

const CONFIDENCE_STYLES: Record<ConfidenceLevel, string> = {
  high:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low:    'bg-red-100 text-red-700 border-red-200',
};

export default function ApprovalCard({
  gateId,
  seenConfidence,
  approverPool,
  currentUserId,
  onDecided,
}: ApprovalCardProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<'approved' | 'rejected' | null>(null);

  const isApprover = approverPool.includes(currentUserId);

  async function decide(decision: 'approved' | 'rejected') {
    if (submitting || decided) return;
    setSubmitting(true);
    setError(null);
    try {
      // TODO: endpoint /api/gates/:gateId/decide may not exist yet (Chunk 12 scope)
      await api.post(`/api/gates/${gateId}/decide`, { decision });
      setDecided(decision);
      onDecided?.(decision);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Failed to submit decision';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (decided) {
    return (
      <div className="mx-4 my-2 rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3">
        <p className="text-[13px] text-slate-400">
          {decided === 'approved' ? 'Approved' : 'Rejected'} by you
        </p>
      </div>
    );
  }

  return (
    <div className="mx-4 my-2 rounded-lg border border-slate-600 bg-slate-800/80 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13.5px] font-medium text-slate-200">Approval required</span>
        <span
          className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${CONFIDENCE_STYLES[seenConfidence.value] ?? CONFIDENCE_STYLES.medium}`}
        >
          {seenConfidence.value} confidence
        </span>
      </div>

      {/* Audit caption */}
      <p className="text-[11.5px] text-slate-500">
        Approve or reject to continue the workflow.
      </p>

      {error && (
        <p className="text-[12px] text-red-400">{error}</p>
      )}

      {isApprover ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => decide('approved')}
            disabled={submitting}
            className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-1.5 text-[13px] font-medium text-white transition-colors"
          >
            {submitting ? 'Submitting...' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={() => decide('rejected')}
            disabled={submitting}
            className="flex-1 rounded-md border border-slate-600 hover:bg-slate-700 disabled:opacity-50 px-3 py-1.5 text-[13px] font-medium text-slate-300 transition-colors"
          >
            Reject
          </button>
        </div>
      ) : (
        <p className="text-[12px] text-slate-500">You are not in the approver pool for this step.</p>
      )}
    </div>
  );
}
