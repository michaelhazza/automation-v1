import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { formatSpendCardPure } from '../components/spend/formatSpendCardPure.js';

// ── Review types ─────────────────────────────────────────────────────────────

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

interface WorkflowContext {
  workflowRunId: string;
  workflowStepId: string | null;
  workflowType: string | undefined;
  label: string | null;
  currentStepIndex: number;
  totalSteps: number;
  workflowStatus: string;
}

// ── Brief (task) types ────────────────────────────────────────────────────────

interface Brief {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assignedAgentId: string | null;
  createdAt: string;
}

interface SubaccountAgent {
  id: string;
  agentId: string;
  agentRole: string | null;
  parentSubaccountAgentId: string | null;
  agent: { name: string; icon: string | null };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTION_BADGE: Record<string, string> = {
  send_email:             'bg-blue-100 text-blue-800',
  update_record:          'bg-green-100 text-green-800',
  create_record:          'bg-indigo-100 text-indigo-800',
  delete_record:          'bg-red-100 text-red-800',
  // Agentic Commerce — spend skills (Chunk 6)
  pay_invoice:            'bg-emerald-100 text-emerald-800',
  purchase_resource:      'bg-emerald-100 text-emerald-800',
  subscribe_to_service:   'bg-emerald-100 text-emerald-800',
  top_up_balance:         'bg-emerald-100 text-emerald-800',
  issue_refund:           'bg-teal-100 text-teal-800',
};

const SPEND_ACTION_TYPES = new Set([
  'pay_invoice', 'purchase_resource', 'subscribe_to_service', 'top_up_balance', 'issue_refund',
]);

const PRIORITY_CLS: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high:   'bg-orange-100 text-orange-700',
  normal: 'bg-slate-100 text-slate-600',
  low:    'bg-green-100 text-green-700',
};

// ── Tabs ──────────────────────────────────────────────────────────────────────

type Tab = 'briefs' | 'review';

// ── New Brief Modal ───────────────────────────────────────────────────────────

function NewBriefModal({
  subaccountId,
  agents,
  onCreated,
  onClose,
}: {
  subaccountId: string;
  agents: SubaccountAgent[];
  onCreated: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Pick the top-level agent (no parent) — this is whichever agent sits at the
  // root of the subaccount hierarchy (e.g. CEO, Orchestrator, etc.)
  const defaultAgent =
    agents.find((a) => !a.parentSubaccountAgentId) ??
    agents[0] ??
    null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required'); return; }
    setSaving(true); setError('');
    try {
      await api.post(`/api/subaccounts/${subaccountId}/tasks`, {
        title: title.trim(),
        description: description.trim() || undefined,
        status: 'inbox',
        priority,
        assignedAgentId: defaultAgent?.agentId ?? undefined,
      });
      onCreated();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Failed to create brief');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out_both]">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-[17px] font-bold text-slate-900 m-0">New Brief</h2>
          <button onClick={onClose} className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          {defaultAgent && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[13px] text-amber-800">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a5 5 0 1 0 0 10A5 5 0 0 0 12 2z"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              Will be assigned to <strong>{defaultAgent.agent.name}</strong>
              {defaultAgent.agentRole && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold capitalize">{defaultAgent.agentRole}</span>}
            </div>
          )}

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Title</label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description <span className="text-slate-400 font-normal">(optional)</span></label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add more context..."
              rows={4}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          {error && <p className="text-[13px] text-red-600 m-0">{error}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving || !title.trim()} className="btn btn-primary">
              {saving ? 'Creating...' : 'Create Brief'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReviewQueuePage({ user: _user }: { user: { id: string; role: string } }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();

  // Tab
  const [tab, setTab] = useState<Tab>('briefs');

  // Review state
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [groupByRun, setGroupByRun] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedReasoning, setExpandedReasoning] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPayload, setEditPayload] = useState('');
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());
  // workflowContext keyed by actionId — populated from agent-inbox endpoint
  const [workflowContextByActionId, setWorkflowContextByActionId] = useState<Map<string, WorkflowContext>>(new Map());
  // spend_approver permission — fetched once; false until confirmed
  const [canApproveSpend, setCanApproveSpend] = useState(false);
  // spend lane filter — true = show spend items in queue
  const [showSpendLane, setShowSpendLane] = useState(true);

  // Briefs state
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [briefsLoading, setBriefsLoading] = useState(true);
  const [agents, setAgents] = useState<SubaccountAgent[]>([]);
  const [showNewBrief, setShowNewBrief] = useState(false);

  const [error, setError] = useState('');

  // ── Loaders ───────────────────────────────────────────────────────────────

  const loadReview = useCallback(async () => {
    if (!subaccountId) return;
    setReviewLoading(true); setError('');
    try {
      const [queueRes, inboxRes] = await Promise.allSettled([
        api.get(`/api/subaccounts/${subaccountId}/review-queue`),
        api.get(`/api/subaccounts/${subaccountId}/agent-inbox`),
      ]);

      if (queueRes.status === 'fulfilled') {
        const sorted = (queueRes.value.data as ReviewItem[]).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        setReviewItems(sorted); setSelectedIds(new Set()); setEditingId(null);
      } else {
        setError('Failed to load review queue');
      }

      if (inboxRes.status === 'fulfilled') {
        const inboxItems = inboxRes.value.data as Array<{ id: string; workflowContext: WorkflowContext | null }>;
        const ctxMap = new Map<string, WorkflowContext>();
        for (const item of inboxItems) {
          if (item.workflowContext) ctxMap.set(item.id, item.workflowContext);
        }
        setWorkflowContextByActionId(ctxMap);
      }
    } finally { setReviewLoading(false); }
  }, [subaccountId]);

  const loadBriefs = useCallback(async () => {
    if (!subaccountId) return;
    setBriefsLoading(true);
    try {
      const res = await api.get(`/api/subaccounts/${subaccountId}/tasks`, { params: { status: 'inbox' } });
      setBriefs(res.data as Brief[]);
    } catch {
      // silently fail — show empty state
    } finally { setBriefsLoading(false); }
  }, [subaccountId]);

  const loadAgents = useCallback(async () => {
    if (!subaccountId) return;
    try {
      const res = await api.get(`/api/subaccounts/${subaccountId}/agents`);
      setAgents(res.data as SubaccountAgent[]);
    } catch { /* ignore */ }
  }, [subaccountId]);

  useEffect(() => {
    loadReview();
    loadBriefs();
    loadAgents();
    api.get('/api/my-permissions')
      .then(({ data }) => {
        const perms: string[] = data?.permissions ?? [];
        const isAdmin = perms.includes('__system_admin__') || perms.includes('__org_admin__');
        setCanApproveSpend(isAdmin || perms.includes('spend_approver'));
      })
      .catch(() => setCanApproveSpend(false));
  }, [loadReview, loadBriefs, loadAgents]);

  // ── Review actions ────────────────────────────────────────────────────────

  const withActionLoading = async (id: string, fn: () => Promise<void>) => {
    setActionLoading((prev) => new Set(prev).add(id));
    try { await fn(); await loadReview(); } catch { setError('Action failed. Please try again.'); }
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
    try { await api.post('/api/review-items/bulk-approve', { ids }); await loadReview(); } catch { setError('Bulk approve failed.'); }
    finally { setActionLoading(new Set()); }
  };

  const handleBulkReject = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setActionLoading(new Set(ids));
    try { await api.post('/api/review-items/bulk-reject', { ids }); await loadReview(); } catch { setError('Bulk reject failed.'); }
    finally { setActionLoading(new Set()); }
  };

  const handleApproveRun = async (runItems: ReviewItem[]) => {
    const ids = runItems.map((i) => i.id);
    setActionLoading(new Set(ids));
    try { await api.post('/api/review-items/bulk-approve', { ids }); await loadReview(); } catch { setError('Approve all in run failed.'); }
    finally { setActionLoading(new Set()); }
  };

  const handleRejectRun = async (runItems: ReviewItem[]) => {
    const ids = runItems.map((i) => i.id);
    setActionLoading(new Set(ids));
    try { await api.post('/api/review-items/bulk-reject', { ids }); await loadReview(); } catch { setError('Reject all in run failed.'); }
    finally { setActionLoading(new Set()); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const toggleSelectAll = () => {
    setSelectedIds(selectedIds.size === reviewItems.length ? new Set() : new Set(reviewItems.map((i) => i.id)));
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
    for (const item of reviewItems) {
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

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderSpendPayload = (item: ReviewItem, isLoading: boolean) => {
    try {
      const p = item.reviewPayloadJson.proposedPayload as Record<string, unknown>;
      const merchant = p.merchant as { id?: string | null; descriptor?: string } | undefined;
      const amountMinor = typeof p.amount === 'number' ? p.amount : null;
      const currency = typeof p.currency === 'string' ? p.currency : null;
      const intent = typeof p.intent === 'string' ? p.intent : null;
      const sptLast4 = typeof (p as Record<string, unknown>).sptLast4 === 'string'
        ? (p as Record<string, unknown>).sptLast4 as string
        : null;

      if (amountMinor === null || currency === null || !merchant?.descriptor) {
        return (
          <p className="text-[13px] text-slate-500 italic">Spend approval — details unavailable</p>
        );
      }

      const { amountDisplay, merchantDisplay } = formatSpendCardPure({
        amountMinor,
        currency,
        merchantId: merchant.id ?? null,
        merchantDescriptor: merchant.descriptor,
      });

      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
            <div className="text-[13px]">
              <span className="text-slate-500 font-medium">Amount: </span>
              <span className="text-slate-900 font-semibold">{amountDisplay}</span>
            </div>
            <div className="text-[13px]">
              <span className="text-slate-500 font-medium">Merchant: </span>
              <span className="text-slate-800">{merchantDisplay}</span>
            </div>
            {intent && (
              <div className="text-[13px]">
                <span className="text-slate-500 font-medium">Intent: </span>
                <span className="text-slate-700">{intent}</span>
              </div>
            )}
            {sptLast4 && (
              <div className="text-[13px]">
                <span className="text-slate-500 font-medium">Card: </span>
                <span className="text-slate-700 font-mono">**** {sptLast4}</span>
              </div>
            )}
          </div>
          {canApproveSpend ? (
            <div className="flex gap-2 mt-1">
              <button onClick={() => handleApprove(item.id)} disabled={isLoading} className="btn btn-sm btn-success">Approve</button>
              <button onClick={() => handleReject(item.id)} disabled={isLoading} className="btn btn-sm btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700">Deny</button>
            </div>
          ) : (
            <p className="text-[12px] text-slate-400 italic">You need the spend_approver permission to action this.</p>
          )}
        </div>
      );
    } catch {
      return (
        <p className="text-[13px] text-slate-500 italic">Spend approval — details unavailable</p>
      );
    }
  };

  const renderProposedPayload = (item: ReviewItem, isLoading = false) => {
    const payload = item.reviewPayloadJson.proposedPayload;
    if (SPEND_ACTION_TYPES.has(item.reviewPayloadJson.actionType)) {
      return renderSpendPayload(item, isLoading);
    }
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

  const renderWorkflowBanner = (wf: WorkflowContext) => {
    const completedSteps = wf.currentStepIndex;
    const pct = wf.totalSteps > 0 ? Math.round((completedSteps / wf.totalSteps) * 100) : 0;
    const label = wf.label ?? wf.workflowType ?? 'Workflow';
    const stepLabel = `Step ${completedSteps + 1} of ${wf.totalSteps}`;

    return (
      <div className="mb-3 px-3 py-2.5 bg-indigo-50 border border-indigo-100 rounded-lg">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span className="text-[12px] font-semibold text-indigo-700">{label}</span>
          </div>
          <span className="text-[11px] text-indigo-500 font-medium">{stepLabel}</span>
        </div>
        <div className="w-full h-1.5 bg-indigo-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  };

  const renderItemCard = (item: ReviewItem) => {
    const isEditing = editingId === item.id;
    const isLoading = actionLoading.has(item.id);
    const badgeCls = ACTION_BADGE[item.reviewPayloadJson.actionType] ?? 'bg-slate-100 text-slate-600';
    const isReasoningExpanded = expandedReasoning.has(item.id);
    const workflowCtx = workflowContextByActionId.get(item.actionId);

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

            {workflowCtx && renderWorkflowBanner(workflowCtx)}

            {!isEditing && renderProposedPayload(item, isLoading)}

            {isEditing && (
              <div className="mt-2">
                <textarea
                  value={editPayload}
                  onChange={(e) => setEditPayload(e.target.value)}
                  className="w-full min-h-[160px] px-3 py-2 border border-indigo-500 rounded-lg text-[12px] font-mono leading-relaxed resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}

            {!SPEND_ACTION_TYPES.has(item.reviewPayloadJson.actionType) && (
              <div className="flex gap-2 mt-3">
                {!isEditing ? (
                  <>
                    <button onClick={() => handleApprove(item.id)} disabled={isLoading} className="btn btn-sm btn-success">Approve</button>
                    <button onClick={() => startEditing(item)} disabled={isLoading} className="btn btn-sm btn-secondary">Edit &amp; Approve</button>
                    <button onClick={() => handleReject(item.id)} disabled={isLoading} className="btn btn-sm btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700">Reject</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => handleEditApprove(item.id)} disabled={isLoading} className="btn btn-sm btn-success">Approve with Edits</button>
                    <button onClick={() => setEditingId(null)} className="btn btn-sm btn-secondary">Cancel</button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Tab: Briefs ───────────────────────────────────────────────────────────

  const renderBriefs = () => {
    if (briefsLoading) return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-lg bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />)}
      </div>
    );

    if (briefs.length === 0) return (
      <div className="py-16 text-center bg-white border border-slate-200 rounded-xl">
        <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-[linear-gradient(135deg,#f0f9ff,#e0f2fe)]">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <p className="font-bold text-[16px] text-slate-900 mb-1.5">No open briefs</p>
        <p className="text-[13.5px] text-slate-500 mb-4">Create a brief to assign work to your AI team.</p>
        <button
          onClick={() => setShowNewBrief(true)}
          className="btn btn-sm btn-primary"
        >
          + New Brief
        </button>
      </div>
    );

    return (
      <div className="flex flex-col gap-2">
        {briefs.map((brief) => (
          <div key={brief.id} className="flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-semibold text-[14px] text-slate-900 truncate">{brief.title}</span>
                <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${PRIORITY_CLS[brief.priority] ?? PRIORITY_CLS.normal}`}>
                  {brief.priority}
                </span>
              </div>
              {brief.description && (
                <p className="text-[13px] text-slate-500 m-0 leading-relaxed line-clamp-2">{brief.description}</p>
              )}
              <p className="text-[12px] text-slate-400 mt-1 m-0">
                Created {new Date(brief.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ── Tab: Review ───────────────────────────────────────────────────────────

  const renderReview = () => {
    if (reviewLoading) return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-lg bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />)}
      </div>
    );

    return (
      <>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-sky-50 border border-sky-200 rounded-lg mb-4">
            <input type="checkbox" checked={selectedIds.size === reviewItems.length} onChange={toggleSelectAll} className="cursor-pointer accent-indigo-500" />
            <span className="text-[13px] text-slate-800 font-medium">{selectedIds.size} selected</span>
            <div className="ml-auto flex gap-2">
              <button onClick={handleBulkApprove} className="btn btn-sm btn-success">Approve Selected</button>
              <button onClick={handleBulkReject} className="btn btn-sm btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700">Reject Selected</button>
            </div>
          </div>
        )}

        {reviewItems.length > 0 && selectedIds.size === 0 && (
          <div className="flex items-center gap-2 mb-3">
            <input type="checkbox" checked={false} onChange={toggleSelectAll} className="cursor-pointer accent-indigo-500" />
            <span className="text-[13px] text-slate-500">Select all ({reviewItems.length} item{reviewItems.length !== 1 ? 's' : ''})</span>
          </div>
        )}

        {reviewItems.length === 0 && (
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

        {!groupByRun && reviewItems.length > 0 && (
          <div className="flex flex-col gap-3">
            {reviewItems
              .filter((item) => showSpendLane || !SPEND_ACTION_TYPES.has(item.reviewPayloadJson.actionType))
              .map((item) => renderItemCard(item))}
          </div>
        )}

        {groupByRun && reviewItems.length > 0 && (
          <div className="flex flex-col gap-5">
            {groupedByRun().map((group) => {
              const visibleItems = group.items.filter(
                (item) => showSpendLane || !SPEND_ACTION_TYPES.has(item.reviewPayloadJson.actionType),
              );
              if (visibleItems.length === 0) return null;
              return (
                <div key={group.agentRunId} className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="flex justify-between items-center px-4 py-3 bg-slate-50 border-b border-slate-200">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[14px] font-semibold text-slate-800">{group.agentName}</span>
                      <span className="text-[11px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                        {visibleItems.length} action{visibleItems.length !== 1 ? 's' : ''}
                      </span>
                      {group.agentRunId !== '__ungrouped__' && (
                        <span className="text-[12px] text-slate-400 font-mono">{group.agentRunId.substring(0, 8)}...</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleApproveRun(visibleItems)} className="btn btn-sm btn-success">Approve All in Run</button>
                      <button onClick={() => handleRejectRun(visibleItems)} className="btn btn-sm btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700">Reject All in Run</button>
                    </div>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {visibleItems.map((item) => renderItemCard(item))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  };

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      {/* Header */}
      <div className="mb-6">
        <Link to={`/admin/subaccounts/${subaccountId}`} className="text-[14px] text-indigo-600 hover:text-indigo-700 no-underline mb-2 inline-block">
          &larr; Back to Company
        </Link>
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-[24px] font-bold text-slate-900 mt-2 mb-1">Inbox</h1>
            <p className="text-[14px] text-slate-500 m-0">Briefs assigned to your AI team and agent actions awaiting approval.</p>
          </div>
          <div className="flex gap-2 items-center">
            {tab === 'review' && (
              <label className="flex items-center gap-1.5 cursor-pointer text-[13px] text-slate-600 select-none px-3 py-1.5 border border-slate-200 rounded-lg bg-slate-50 hover:bg-slate-100">
                <input
                  type="checkbox"
                  checked={showSpendLane}
                  onChange={() => setShowSpendLane(!showSpendLane)}
                  className="cursor-pointer accent-emerald-600"
                />
                Spend
              </label>
            )}
            {tab === 'review' && (
              <button
                onClick={() => setGroupByRun(!groupByRun)}
                className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors border ${groupByRun ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}
              >
                {groupByRun ? 'Grouped by Run' : 'Group by Run'}
              </button>
            )}
            {tab === 'review' && (
              <button onClick={loadReview} className="btn btn-sm btn-secondary">
                Refresh
              </button>
            )}
            {tab === 'briefs' && (
              <button
                onClick={() => setShowNewBrief(true)}
                className="btn btn-sm btn-primary"
              >
                + New Brief
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg mb-4 text-[14px] flex justify-between items-center">
          {error}
          <button onClick={() => setError('')} className="bg-transparent border-0 cursor-pointer text-red-700 text-lg leading-none">&times;</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-6 w-fit">
        <button
          onClick={() => setTab('briefs')}
          className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors border-0 cursor-pointer ${tab === 'briefs' ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-500 hover:text-slate-700'}`}
        >
          Briefs
          {briefs.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-[11px] font-bold">{briefs.length}</span>
          )}
        </button>
        <button
          onClick={() => setTab('review')}
          className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors border-0 cursor-pointer ${tab === 'review' ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-500 hover:text-slate-700'}`}
        >
          Needs Review
          {reviewItems.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[11px] font-bold">{reviewItems.length}</span>
          )}
        </button>
      </div>

      {/* Tab content */}
      {tab === 'briefs' && renderBriefs()}
      {tab === 'review' && renderReview()}

      {/* New Brief modal */}
      {showNewBrief && subaccountId && (
        <NewBriefModal
          subaccountId={subaccountId}
          agents={agents}
          onCreated={loadBriefs}
          onClose={() => setShowNewBrief(false)}
        />
      )}
    </div>
  );
}
