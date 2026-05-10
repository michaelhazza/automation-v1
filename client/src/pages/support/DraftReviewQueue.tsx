import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../lib/api';
import StatusPill from '../../components/support/StatusPill';
import CollisionCallout from '../../components/support/CollisionCallout';
import BackLinkAwaitingBadge from '../../components/support/BackLinkAwaitingBadge';

interface Draft {
  id: string;
  ticketId: string;
  proposedBodyText: string;
  proposedVisibility: 'public' | 'internal';
  status: string;
  createdAt: string;
  preflightFailureReason?: string | null;
  reconciliationAttemptCount?: number;
  lastReconciliationAt?: string | null;
}

export default function DraftReviewQueue() {
  const { id: selectedIdParam } = useParams<{ id: string }>();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(selectedIdParam ?? null);
  const [actionLoading, setActionLoading] = useState(false);
  const [hasOverrideCollisionPerm, setHasOverrideCollisionPerm] = useState(false);

  const load = useCallback(() => {
    api.get<{ drafts: Draft[] }>('/api/support/drafts')
      .then(({ data }) => {
        setDrafts(data.drafts ?? []);
        setError(null);
      })
      .catch(() => setError('Failed to load drafts.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    api.get<{ permissions: string[] }>('/api/my-permissions')
      .then(({ data }) => {
        setHasOverrideCollisionPerm(data.permissions?.includes('support.draft.override_collision') ?? false);
      })
      .catch(() => {
        // permissions fetch failure is non-fatal; default to no override perm
      });
  }, []);

  const selected = drafts.find(d => d.id === selectedId) ?? null;
  const isReconciliation = selected?.status === 'needs_reconciliation';
  const isDispatching = selected?.status === 'dispatching';
  const hasCollision = selected?.preflightFailureReason === 'human_collision_blocked';

  const handleApprove = async (overrideCollision = false) => {
    if (!selected) return;
    setActionLoading(true);
    try {
      await api.post(`/api/support/drafts/${selected.id}/approve`, { overrideCollision });
      load();
      setSelectedId(null);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!selected) return;
    setActionLoading(true);
    try {
      await api.post(`/api/support/drafts/${selected.id}/reject`, { reason: 'Rejected from review queue' });
      load();
      setSelectedId(null);
    } finally {
      setActionLoading(false);
    }
  };

  const handleManualResolve = async (action: 'mark_sent' | 'mark_failed' | 'retry_reconciliation') => {
    if (!selected) return;
    setActionLoading(true);
    try {
      await api.post(`/api/support/drafts/${selected.id}/manual-resolve`, { action });
      load();
      setSelectedId(null);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <h1 className="text-lg font-semibold text-slate-900">Draft Review</h1>
        <p className="text-xs text-slate-500 mt-0.5">Drafts awaiting approval before sending</p>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Draft list */}
        <div className="w-72 flex-shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
          {loading && (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
            </div>
          )}
          {error && <p className="px-4 py-3 text-xs text-red-600">{error}</p>}
          {!loading && !error && drafts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <p className="text-sm font-medium text-slate-700">No drafts awaiting review</p>
              <p className="text-xs text-slate-400 mt-1">Check back later</p>
            </div>
          )}
          {drafts.map(draft => (
            <button
              key={draft.id}
              onClick={() => setSelectedId(draft.id)}
              className={`w-full text-left p-3 border-b border-slate-100 transition-colors ${
                selectedId === draft.id
                  ? 'bg-indigo-50 border-l-2 border-l-indigo-600'
                  : draft.preflightFailureReason === 'human_collision_blocked'
                    ? 'bg-red-50 hover:bg-red-100'
                    : draft.status === 'needs_reconciliation'
                      ? 'bg-amber-50 hover:bg-amber-100'
                      : draft.status === 'dispatching'
                        ? 'bg-slate-50 hover:bg-slate-100'
                        : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <StatusPill status={draft.status} />
                {draft.status === 'manually_marked_sent' && <BackLinkAwaitingBadge />}
                {draft.preflightFailureReason === 'provider_conflict' && (
                  <span className="text-xs text-amber-700 font-medium">Conflict detected, refresh ticket</span>
                )}
                {draft.preflightFailureReason === 'human_collision_blocked' && (
                  <span className="text-xs text-red-700 font-medium">Human collision</span>
                )}
              </div>
              <p className="text-xs font-medium text-slate-700 truncate">{draft.ticketId}</p>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">{draft.proposedBodyText}</p>
            </button>
          ))}
        </div>

        {/* Detail panel */}
        <div className="flex-1 overflow-y-auto bg-slate-50">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
              <p className="text-sm">Select a draft to review</p>
            </div>
          ) : (
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <StatusPill status={selected.status} />
                <span className="text-xs text-slate-500">
                  {selected.proposedVisibility === 'internal' ? 'Internal note' : 'Public reply'}
                </span>
                <span className="text-xs text-slate-400">
                  {new Date(selected.createdAt).toLocaleString()}
                </span>
              </div>

              {selected.preflightFailureReason === 'provider_conflict' && (
                <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700 font-medium">
                  Conflict detected, refresh ticket
                </div>
              )}

              {hasCollision && (
                <CollisionCallout
                  message="A human agent may have already replied to this ticket."
                  onOverride={hasOverrideCollisionPerm ? () => handleApprove(true) : undefined}
                  overriding={actionLoading}
                />
              )}

              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden mb-4">
                <div className="px-4 py-2.5 bg-indigo-50 border-b border-indigo-100">
                  <span className="text-xs font-semibold text-indigo-700">Proposed reply</span>
                </div>
                <div className="px-4 py-4 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                  {selected.proposedBodyText}
                </div>
              </div>

              {isDispatching && (
                <div className="flex items-center gap-2 text-xs text-slate-500 mt-2">
                  <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
                  still dispatching...
                </div>
              )}

              {!isReconciliation && !isDispatching && !hasCollision && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove()}
                    disabled={actionLoading}
                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={actionLoading}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    Reject
                  </button>
                </div>
              )}

              {isReconciliation && (
                <div className="mt-2 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-xs font-semibold text-amber-700 mb-2">Manual resolution required</p>
                  {(selected.reconciliationAttemptCount ?? 0) > 0 && (
                    <p className="text-xs text-amber-600 mb-1">
                      Reconciliation attempt {selected.reconciliationAttemptCount}
                      {selected.lastReconciliationAt && (
                        <> · Last tried {new Date(selected.lastReconciliationAt).toLocaleString()}</>
                      )}
                    </p>
                  )}
                  <p className="text-xs text-amber-600 mb-3">This draft could not be automatically reconciled. Choose an action:</p>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => handleManualResolve('retry_reconciliation')}
                      disabled={actionLoading}
                      className="px-3 py-1.5 rounded bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
                    >
                      Retry reconciliation
                    </button>
                    <button
                      onClick={() => handleManualResolve('mark_sent')}
                      disabled={actionLoading}
                      className="px-3 py-1.5 rounded border border-amber-300 text-amber-700 text-xs font-medium hover:bg-amber-100 disabled:opacity-50 transition-colors"
                    >
                      Mark provider send as verified
                    </button>
                    <button
                      onClick={() => handleManualResolve('mark_failed')}
                      disabled={actionLoading}
                      className="px-3 py-1.5 rounded border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 transition-colors"
                    >
                      Mark as failed in provider
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
