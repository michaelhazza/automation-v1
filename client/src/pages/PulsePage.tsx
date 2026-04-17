import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import api from '../lib/api';
import { usePulseAttention, type PulseItem } from '../hooks/usePulseAttention';
import { Lane } from '../components/pulse/Lane';
import { MajorApprovalModal } from '../components/pulse/MajorApprovalModal';
import { HistoryTab } from '../components/pulse/HistoryTab';

interface Props {
  user: { id: string; role?: string };
}

export default function PulsePage({ user }: Props) {
  const { subaccountId } = useParams<{ subaccountId?: string }>();
  const scope = subaccountId ? 'subaccount' : 'org';

  const [tab, setTab] = useState<'attention' | 'history'>('attention');
  const [majorModalItem, setMajorModalItem] = useState<PulseItem | null>(null);
  const [rejectingItem, setRejectingItem] = useState<PulseItem | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const { attention, isLoading, error, refetch, removeItem } = usePulseAttention({
    scope,
    subaccountId,
  });

  const handleApprove = useCallback(async (item: PulseItem) => {
    if (item.lane === 'major') {
      setMajorModalItem(item);
      return;
    }
    setPendingIds(prev => new Set(prev).add(item.id));
    try {
      await api.post(`/api/review-items/${item.id}/approve`);
      removeItem(item.id);
    } catch (err: unknown) {
      const resp = (err as { response?: { status?: number; data?: { error?: { code?: string } } } })?.response;
      if (resp?.status === 412 && resp.data?.error?.code === 'MAJOR_ACK_REQUIRED') {
        setMajorModalItem(item);
      } else if (resp?.status === 409) {
        removeItem(item.id);
      } else {
        refetch();
      }
    } finally {
      setPendingIds(prev => { const next = new Set(prev); next.delete(item.id); return next; });
    }
  }, [removeItem, refetch]);

  const handleReject = useCallback((item: PulseItem) => {
    setRejectingItem(item);
    setRejectComment('');
  }, []);

  const submitReject = useCallback(async () => {
    if (!rejectingItem || !rejectComment.trim()) return;
    const itemId = rejectingItem.id;
    setRejectingItem(null);
    setPendingIds(prev => new Set(prev).add(itemId));
    try {
      await api.post(`/api/review-items/${itemId}/reject`, {
        comment: rejectComment,
      });
      removeItem(itemId);
    } catch {
      refetch();
    } finally {
      setPendingIds(prev => { const next = new Set(prev); next.delete(itemId); return next; });
    }
  }, [rejectingItem, rejectComment, removeItem, refetch]);

  const handleMajorApproved = useCallback(() => {
    if (majorModalItem) removeItem(majorModalItem.id);
    setMajorModalItem(null);
  }, [majorModalItem, removeItem]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-800">Pulse</h1>
        {attention?.isPartial && (
          <div className="flex items-center gap-2 rounded bg-yellow-50 border border-yellow-200 px-3 py-1.5 text-xs text-yellow-700">
            Some items may be missing
            <button onClick={refetch} className="underline hover:no-underline">Refresh</button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 mb-6">
        <button
          onClick={() => setTab('attention')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'attention'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Attention {attention ? `(${attention.counts.total})` : ''}
        </button>
        <button
          onClick={() => setTab('history')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'history'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          History
        </button>
      </div>

      {tab === 'attention' && (
        <>
          {isLoading && !attention && (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            </div>
          )}

          {error && !attention && (
            <div className="rounded bg-red-50 border border-red-200 p-4 text-sm text-red-700">
              {error}
              <button onClick={refetch} className="ml-2 underline">Retry</button>
            </div>
          )}

          {attention && (
            <div className="space-y-6">
              {attention.counts.total === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="text-4xl mb-3">&#10003;</div>
                  <h3 className="text-lg font-medium text-slate-700">Nothing needs your attention</h3>
                  <p className="mt-1 text-sm text-slate-500">Pulse will surface items as they come in.</p>
                </div>
              )}
              {attention.counts.total > 0 && (
                <>
                  <Lane laneId="client" items={attention.lanes.client} onApprove={handleApprove} onReject={handleReject} pendingIds={pendingIds} />
                  <Lane laneId="major" items={attention.lanes.major} onApprove={handleApprove} onReject={handleReject} pendingIds={pendingIds} />
                  <Lane laneId="internal" items={attention.lanes.internal} onApprove={handleApprove} onReject={handleReject} pendingIds={pendingIds} />
                </>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        <HistoryTab scope={scope} subaccountId={subaccountId} />
      )}

      {/* Major approval modal */}
      {majorModalItem && (
        <MajorApprovalModal
          item={majorModalItem}
          onClose={() => setMajorModalItem(null)}
          onApproved={handleMajorApproved}
        />
      )}

      {/* Reject modal */}
      {rejectingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setRejectingItem(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-800">Reject Action</h3>
            <p className="mt-2 text-sm text-slate-600">
              Please provide a reason for rejecting this action.
            </p>
            <textarea
              value={rejectComment}
              onChange={e => setRejectComment(e.target.value)}
              placeholder="Reason for rejection..."
              className="mt-3 w-full rounded border border-slate-300 p-3 text-sm text-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              rows={3}
            />
            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                onClick={() => setRejectingItem(null)}
                className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={submitReject}
                disabled={!rejectComment.trim()}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
