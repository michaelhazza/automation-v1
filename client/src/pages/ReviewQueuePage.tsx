import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';

interface ReviewPayload {
  actionType: string;
  reasoning: string;
  proposedPayload: Record<string, unknown>;
  agentName?: string;
  runTimestamp?: string;
  context?: Record<string, unknown>;
}

interface ReviewItem {
  id: string;
  organisationId: string;
  subaccountId: string;
  actionId: string;
  agentRunId: string | null;
  reviewStatus: 'pending' | 'edited_pending' | 'approved' | 'rejected' | 'completed';
  reviewPayloadJson: ReviewPayload;
  humanEditJson: Record<string, unknown> | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

interface RunGroup {
  agentRunId: string;
  agentName: string;
  items: ReviewItem[];
}

const ACTION_BADGE: Record<string, string> = {
  send_email:    'bg-blue-100 text-blue-800',
  update_record: 'bg-green-100 text-green-800',
  create_record: 'bg-indigo-100 text-indigo-800',
  delete_record: 'bg-red-100 text-red-800',
};

export default function ReviewQueuePage({ user: _user }: { user: { id: string; role: string } }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [groupByRun, setGroupByRun] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedReasoning, setExpandedReasoning] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPayload, setEditPayload] = useState('');
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!subaccountId) return;
    setLoading(true); setError('');
    try {
      const res = await api.get(`/api/subaccounts/${subaccountId}/review-queue`);
      const sorted = (res.data as ReviewItem[]).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setItems(sorted); setSelectedIds(new Set()); setEditingId(null);
    } catch {
      setError('Failed to load review queue');
    } finally { setLoading(false); }
  }, [subaccountId]);

  useEffect(() => { load(); }, [load]);

  const withActionLoading = async (id: string, fn: () => Promise<void>) => {
    setActionLoading((prev) => new Set(prev).add(id));
    try { await fn(); await load(); } catch { setError('Action failed. Please try again.'); }
    finally {
      setActionLoading((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const handleApprove = (id: string) => withActionLoading(id, () => api.post(`/api/review-items/${id}/approve`));

  const handleEditApprove = (id: string) => {
    let parsed: object;
    try { parsed = JSON.parse(editPayload); } catch { setError('Invalid JSON in edited payload'); return; }
    return withActionLoading(id, () => api.post(`/api/review-items/${id}/approve`, { edits: parsed }));
  };

  const handleReject = (id: string) => withActionLoading(id, () => api.post(`/api/review-items/${id}/reject`));

  const handleBulkApprove = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setActionLoading(new Set(ids));
    try { await api.post('/api/review-items/bulk-approve', { ids }); await load(); } catch { setError('Bulk approve failed.'); }
    finally { setActionLoading(new Set()); }
  };

  const handleBulkReject = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setActionLoading(new Set(ids));
    try { await api.post('/api/review-items/bulk-reject', { ids }); await load(); } catch { setError('Bulk reject failed.'); }
    finally { setActionLoading(new Set()); }
  };

  const handleApproveRun = async (runItems: ReviewItem[]) => {
    const ids = runItems.map((i) => i.id);
    setActionLoading(new Set(ids));
    try { await api.post('/api/review-items/bulk-approve', { ids }); await load(); } catch { setError('Approve all in run failed.'); }
    finally { setActionLoading(new Set()); }
  };

  const handleRejectRun = async (runItems: ReviewItem[]) => {
    const ids = runItems.map((i) => i.id);
    setActionLoading(new Set(ids));
    try { await api.post('/api/review-items/bulk-reject', { ids }); await load(); } catch { setError('Reject all in run failed.'); }
    finally { setActionLoading(new Set()); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const toggleSelectAll = () => {
    setSelectedIds(selectedIds.size === items.length ? new Set() : new Set(items.map((i) => i.id)));
  };

  const toggleReasoning = (id: string) => {
    setExpandedReasoning((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const startEditing = (item: ReviewItem) => {
    setEditingId(item.id);
    setEditPayload(JSON.stringify(item.reviewPayloadJson.proposedPayload, null, 2));
  };

  const groupedByRun = (): RunGroup[] => {
    const map = new Map<string, RunGroup>();
    const ungrouped: ReviewItem[] = [];
    for (const item of items) {
      if (item.agentRunId) {
        if (!map.has(item.agentRunId)) map.set(item.agentRunId, { agentRunId: item.agentRunId, agentName: item.reviewPayloadJson.agentName ?? 'Unknown Agent', items: [] });
        map.get(item.agentRunId)!.items.push(item);
      } else { ungrouped.push(item); }
    }
    const groups = Array.from(map.values());
    if (ungrouped.length > 0) groups.push({ agentRunId: '__ungrouped__', agentName: 'Ungrouped', items: ungrouped });
    return groups;
  };

  const formatActionType = (type: string) => type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const renderProposedPayload = (item: ReviewItem) => {
    const payload = item.reviewPayloadJson.proposedPayload;
    if (item.reviewPayloadJson.actionType === 'send_email' && payload) {
      const p = payload as Record<string, unknown>;
      return (
        <div className="flex flex-col gap-1.5">
          {!!p.to && <div className="text-[13px]"><span className="text-slate-500 font-medium">To: </span><span className="text-slate-800">{String(p.to)}</span></div>}
          {!!p.subject && <div className="text-[13px]"><span className="text-slate-500 font-medium">Subject: </span><span className="text-slate-800 font-medium">{String(p.subject)}</span></div>}
          {!!p.body && <div className="text-[13px] text-slate-700 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 whitespace-pre-wrap leading-relaxed max-h-[200px] overflow-y-auto">{String(p.body)}</div>}
        </div>
      );
    }
    return (
      <pre className="text-[12px] text-slate-700 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 whitespace-pre-wrap leading-relaxed max-h-[200px] overflow-y-auto m-0 font-mono">
        {JSON.stringify(payload, null, 2)}
      </pre>
    );
  };

  const renderItemCard = (item: ReviewItem) => {
    const isEditing = editingId === item.id;
    const isLoading = actionLoading.has(item.id);
    const badgeCls = ACTION_BADGE[item.reviewPayloadJson.actionType] ?? 'bg-slate-100 text-slate-600';
    const isReasoningExpanded = expandedReasoning.has(item.id);

    return (
      <div key={item.id} className={`p-4 bg-white border border-slate-200 rounded-lg ${isLoading ? 'opacity-60 pointer-events-none' : ''}`}>
        <div className="flex items-start gap-3">
          <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} className="mt-1 cursor-pointer accent-indigo-500" />
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className={`inline-block px-2.5 py-0.5 rounded text-[12px] font-semibold ${badgeCls}`}>
                {formatActionType(item.reviewPayloadJson.actionType)}
              </span>
              {item.reviewPayloadJson.agentName && <span className="text-[13px] text-slate-600 font-medium">{item.reviewPayloadJson.agentName}</span>}
              {item.reviewPayloadJson.runTimestamp && (
                <span className="text-[12px] text-slate-400">
                  {new Date(item.reviewPayloadJson.runTimestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {item.reviewStatus === 'edited_pending' && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold">Edited</span>}
              <span className="text-[12px] text-slate-300 ml-auto">
                {new Date(item.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            <button
              onClick={() => toggleReasoning(item.id)}
              className={`bg-transparent border-0 cursor-pointer p-0 text-[13px] text-indigo-600 font-medium flex items-center gap-1 ${isReasoningExpanded ? 'mb-1.5' : 'mb-2.5'}`}
            >
              <span className={`text-[10px] inline-block transition-transform ${isReasoningExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
              Agent Reasoning
            </button>
            {isReasoningExpanded && (
              <div className="text-[13px] text-slate-600 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 mb-2.5 leading-relaxed">
                {item.reviewPayloadJson.reasoning}
              </div>
            )}

            {!isEditing && renderProposedPayload(item)}

            {isEditing && (
              <div className="mt-2">
                <textarea
                  value={editPayload}
                  onChange={(e) => setEditPayload(e.target.value)}
                  className="w-full min-h-[160px] px-3 py-2 border border-indigo-500 rounded-lg text-[12px] font-mono leading-relaxed resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}

            <div className="flex gap-2 mt-3">
              {!isEditing ? (
                <>
                  <button onClick={() => handleApprove(item.id)} disabled={isLoading} className="px-3.5 py-1.5 bg-green-600 hover:bg-green-700 text-white border-0 rounded-lg text-[13px] font-medium cursor-pointer transition-colors">Approve</button>
                  <button onClick={() => startEditing(item)} disabled={isLoading} className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-lg text-[13px] font-medium cursor-pointer transition-colors">Edit &amp; Approve</button>
                  <button onClick={() => handleReject(item.id)} disabled={isLoading} className="px-3.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-lg text-[13px] font-medium cursor-pointer transition-colors">Reject</button>
                </>
              ) : (
                <>
                  <button onClick={() => handleEditApprove(item.id)} disabled={isLoading} className="px-3.5 py-1.5 bg-green-600 hover:bg-green-700 text-white border-0 rounded-lg text-[13px] font-medium cursor-pointer transition-colors">Approve with Edits</button>
                  <button onClick={() => setEditingId(null)} className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-lg text-[13px] font-medium cursor-pointer transition-colors">Cancel</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="h-7 w-48 rounded mb-4 bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
        {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-lg mb-3 bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />)}
      </div>
    );
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="mb-6">
        <Link to={`/admin/subaccounts/${subaccountId}`} className="text-[14px] text-indigo-600 hover:text-indigo-700 no-underline mb-2 inline-block">
          &larr; Back to Subaccount
        </Link>
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-[24px] font-bold text-slate-900 mt-2 mb-1">Review Queue</h1>
            <p className="text-[14px] text-slate-500 m-0">Approve or reject agent-proposed actions before they execute.</p>
          </div>
          <div className="flex gap-2 items-center">
            <button
              onClick={() => setGroupByRun(!groupByRun)}
              className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors border ${groupByRun ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}
            >
              {groupByRun ? 'Grouped by Run' : 'Group by Run'}
            </button>
            <button onClick={load} className="px-4 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-[13px] text-slate-600 transition-colors">
              Refresh
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg mb-4 text-[14px] flex justify-between items-center">
          {error}
          <button onClick={() => setError('')} className="bg-transparent border-0 cursor-pointer text-red-700 text-lg leading-none">&times;</button>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-sky-50 border border-sky-200 rounded-lg mb-4">
          <input type="checkbox" checked={selectedIds.size === items.length} onChange={toggleSelectAll} className="cursor-pointer accent-indigo-500" />
          <span className="text-[13px] text-slate-800 font-medium">{selectedIds.size} selected</span>
          <div className="ml-auto flex gap-2">
            <button onClick={handleBulkApprove} className="px-3.5 py-1.5 bg-green-600 hover:bg-green-700 text-white border-0 rounded-lg text-[13px] font-medium cursor-pointer transition-colors">Approve Selected</button>
            <button onClick={handleBulkReject} className="px-3.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-lg text-[13px] font-medium cursor-pointer transition-colors">Reject Selected</button>
          </div>
        </div>
      )}

      {items.length > 0 && selectedIds.size === 0 && (
        <div className="flex items-center gap-2 mb-3">
          <input type="checkbox" checked={false} onChange={toggleSelectAll} className="cursor-pointer accent-indigo-500" />
          <span className="text-[13px] text-slate-500">Select all ({items.length} item{items.length !== 1 ? 's' : ''})</span>
        </div>
      )}

      {items.length === 0 && (
        <div className="py-16 text-center bg-white border border-slate-200 rounded-xl">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-[linear-gradient(135deg,#f0fdf4,#dcfce7)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="font-bold text-[16px] text-slate-900 mb-1.5">No pending review items</p>
          <p className="text-[13.5px] text-slate-500">When agents propose actions that require approval, they will appear here.</p>
        </div>
      )}

      {!groupByRun && items.length > 0 && (
        <div className="flex flex-col gap-3">
          {items.map((item) => renderItemCard(item))}
        </div>
      )}

      {groupByRun && items.length > 0 && (
        <div className="flex flex-col gap-5">
          {groupedByRun().map((group) => (
            <div key={group.agentRunId} className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex justify-between items-center px-4 py-3 bg-slate-50 border-b border-slate-200">
                <div className="flex items-center gap-2.5">
                  <span className="text-[14px] font-semibold text-slate-800">{group.agentName}</span>
                  <span className="text-[11px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                    {group.items.length} action{group.items.length !== 1 ? 's' : ''}
                  </span>
                  {group.agentRunId !== '__ungrouped__' && (
                    <span className="text-[12px] text-slate-400 font-mono">{group.agentRunId.substring(0, 8)}...</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleApproveRun(group.items)} className="px-3.5 py-1.5 bg-green-600 hover:bg-green-700 text-white border-0 rounded-lg text-[13px] font-medium cursor-pointer transition-colors">Approve All in Run</button>
                  <button onClick={() => handleRejectRun(group.items)} className="px-3.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-lg text-[13px] font-medium cursor-pointer transition-colors">Reject All in Run</button>
                </div>
              </div>
              <div className="divide-y divide-slate-50">
                {group.items.map((item) => renderItemCard(item))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
