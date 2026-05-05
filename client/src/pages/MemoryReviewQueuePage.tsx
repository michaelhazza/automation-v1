/**
 * MemoryReviewQueuePage — HITL review queue for a subaccount
 *
 * Renders `memory_review_queue` items filtered by subaccount. Three item
 * types render differently:
 *   - belief_conflict  → side-by-side belief diff + "Accept new / Accept existing" buttons
 *   - block_proposal   → block preview + approve/reject
 *   - clarification_pending → read-only audit view (resolved via ClarificationInbox)
 *
 * Spec: docs/memory-and-briefings-spec.md §5.3 (S7)
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../lib/api';

interface QueueItem {
  id: string;
  subaccountId: string;
  itemType: 'belief_conflict' | 'block_proposal' | 'clarification_pending';
  payload: Record<string, unknown>;
  confidence: number;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  createdByAgentId: string | null;
  resolvedAt: string | null;
}

type FilterStatus = 'pending' | 'approved' | 'rejected' | 'all';
type FilterType = 'all' | 'belief_conflict' | 'block_proposal' | 'clarification_pending';

export default function MemoryReviewQueuePage() {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('pending');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [processingId, setProcessingId] = useState<string | null>(null);

  const load = async () => {
    if (!subaccountId) return;
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      if (typeFilter !== 'all') params.itemType = typeFilter;
      const qs = new URLSearchParams(params).toString();
      const url = `/api/subaccounts/${subaccountId}/memory-review-queue${qs ? `?${qs}` : ''}`;
      const res = await api.get<{ items: QueueItem[] }>(url);
      setItems(res.data.items ?? []);
      setError(null);
    } catch (err) {
      setError('Failed to load review queue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // reason: `load` is an inline async function that closes over state setters; only the filter keys are the intended triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subaccountId, statusFilter, typeFilter]);

  async function approve(item: QueueItem, acceptSide?: 'new' | 'existing') {
    setProcessingId(item.id);
    try {
      await api.post(`/api/memory-review-queue/${item.id}/approve`, { acceptSide });
      await load();
    } catch {
      setError('Approval failed.');
    } finally {
      setProcessingId(null);
    }
  }

  async function reject(item: QueueItem) {
    setProcessingId(item.id);
    try {
      await api.post(`/api/memory-review-queue/${item.id}/reject`, {});
      await load();
    } catch {
      setError('Rejection failed.');
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-800">Memory Review Queue</h1>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
            className="text-sm border border-slate-200 rounded px-2 py-1"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All statuses</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as FilterType)}
            className="text-sm border border-slate-200 rounded px-2 py-1"
          >
            <option value="all">All types</option>
            <option value="belief_conflict">Belief conflicts</option>
            <option value="block_proposal">Block proposals</option>
            <option value="clarification_pending">Clarifications</option>
          </select>
        </div>
      </div>

      {loading && <div className="text-sm text-slate-400">Loading…</div>}
      {error && <div className="text-sm text-red-600 mb-3">{error}</div>}

      {!loading && items.length === 0 && (
        <div className="text-sm text-slate-400 italic py-6 text-center">
          No items match the current filter.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <QueueCard
            key={item.id}
            item={item}
            disabled={processingId === item.id}
            onApprove={(side) => approve(item, side)}
            onReject={() => reject(item)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-item card
// ---------------------------------------------------------------------------

interface QueueCardProps {
  item: QueueItem;
  disabled: boolean;
  onApprove: (acceptSide?: 'new' | 'existing') => void;
  onReject: () => void;
}

function QueueCard({ item, disabled, onApprove, onReject }: QueueCardProps) {
  const typeColor: Record<string, string> = {
    belief_conflict: 'bg-amber-100 text-amber-800',
    block_proposal: 'bg-emerald-100 text-emerald-800',
    clarification_pending: 'bg-sky-100 text-sky-800',
  };

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${
            typeColor[item.itemType] ?? 'bg-slate-100 text-slate-600'
          }`}
        >
          {item.itemType.replace(/_/g, ' ')}
        </span>
        <span className="text-xs text-slate-400">
          {new Date(item.createdAt).toLocaleString()} · confidence{' '}
          {(item.confidence ?? 0).toFixed(2)}
        </span>
      </div>

      {item.itemType === 'belief_conflict' && (
        <BeliefConflictBody
          payload={item.payload}
          disabled={disabled}
          onApprove={onApprove}
          onReject={onReject}
        />
      )}
      {item.itemType === 'block_proposal' && (
        <BlockProposalBody
          payload={item.payload}
          disabled={disabled}
          onApprove={() => onApprove()}
          onReject={onReject}
        />
      )}
      {item.itemType === 'clarification_pending' && (
        <ClarificationAuditBody payload={item.payload} />
      )}
    </div>
  );
}

function BeliefConflictBody({
  payload,
  disabled,
  onApprove,
  onReject,
}: {
  payload: Record<string, unknown>;
  disabled: boolean;
  onApprove: (side: 'new' | 'existing') => void;
  onReject: () => void;
}) {
  return (
    <div>
      <p className="text-sm text-slate-700 mb-2">
        Conflicting beliefs for <code>{String(payload.entityKey ?? 'unknown')}</code>
      </p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="border border-slate-200 rounded p-3 bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 mb-1">New belief</p>
          <p className="text-sm text-slate-800">{String(payload.newValue ?? '')}</p>
          <p className="text-xs text-slate-400 mt-1">
            confidence {Number(payload.newConfidence ?? 0).toFixed(2)}
          </p>
        </div>
        <div className="border border-slate-200 rounded p-3 bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 mb-1">Existing belief</p>
          <p className="text-sm text-slate-800">{String(payload.existingValue ?? '')}</p>
          <p className="text-xs text-slate-400 mt-1">
            confidence {Number(payload.existingConfidence ?? 0).toFixed(2)}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onApprove('new')}
          className="text-xs px-3 py-1.5 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
        >
          Accept new
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onApprove('existing')}
          className="text-xs px-3 py-1.5 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
        >
          Accept existing
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onReject}
          className="text-xs px-3 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 ml-auto"
        >
          Reject both
        </button>
      </div>
    </div>
  );
}

function BlockProposalBody({
  payload,
  disabled,
  onApprove,
  onReject,
}: {
  payload: Record<string, unknown>;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div>
      <p className="text-sm text-slate-800 font-medium mb-1">
        {String(payload.name ?? payload.blockName ?? 'Proposed block')}
      </p>
      <pre className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-3 whitespace-pre-wrap max-h-48 overflow-y-auto mb-3">
        {String(payload.content ?? '').slice(0, 2000)}
      </pre>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onApprove}
          className="text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Approve &amp; activate
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onReject}
          className="text-xs px-3 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 ml-auto"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function ClarificationAuditBody({ payload }: { payload: Record<string, unknown> }) {
  return (
    <div>
      <p className="text-sm text-slate-800 whitespace-pre-wrap mb-2">
        {String(payload.question ?? '')}
      </p>
      <p className="text-xs text-slate-400">
        Read-only — clarifications resolve via the agent run inbox, not this page.
      </p>
    </div>
  );
}
