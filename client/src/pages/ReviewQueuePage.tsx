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

export default function ReviewQueuePage({ user }: { user: { id: string; role: string } }) {
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
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/api/subaccounts/${subaccountId}/review-queue`);
      const sorted = (res.data as ReviewItem[]).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      setItems(sorted);
      setSelectedIds(new Set());
      setEditingId(null);
    } catch {
      setError('Failed to load review queue');
    } finally {
      setLoading(false);
    }
  }, [subaccountId]);

  useEffect(() => { load(); }, [load]);

  // --- Actions ---

  const withActionLoading = async (id: string, fn: () => Promise<void>) => {
    setActionLoading(prev => new Set(prev).add(id));
    try {
      await fn();
      await load();
    } catch {
      setError('Action failed. Please try again.');
    } finally {
      setActionLoading(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleApprove = (id: string) =>
    withActionLoading(id, () => api.post(`/api/review-items/${id}/approve`));

  const handleEditApprove = (id: string) => {
    let parsed: object;
    try {
      parsed = JSON.parse(editPayload);
    } catch {
      setError('Invalid JSON in edited payload');
      return;
    }
    return withActionLoading(id, () =>
      api.post(`/api/review-items/${id}/approve`, { edits: parsed })
    );
  };

  const handleReject = (id: string) =>
    withActionLoading(id, () => api.post(`/api/review-items/${id}/reject`));

  const handleBulkApprove = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setActionLoading(new Set(ids));
    try {
      await api.post('/api/review-items/bulk-approve', { ids });
      await load();
    } catch {
      setError('Bulk approve failed.');
    } finally {
      setActionLoading(new Set());
    }
  };

  const handleBulkReject = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setActionLoading(new Set(ids));
    try {
      await api.post('/api/review-items/bulk-reject', { ids });
      await load();
    } catch {
      setError('Bulk reject failed.');
    } finally {
      setActionLoading(new Set());
    }
  };

  const handleApproveRun = async (runItems: ReviewItem[]) => {
    const ids = runItems.map(i => i.id);
    setActionLoading(new Set(ids));
    try {
      await api.post('/api/review-items/bulk-approve', { ids });
      await load();
    } catch {
      setError('Approve all in run failed.');
    } finally {
      setActionLoading(new Set());
    }
  };

  const handleRejectRun = async (runItems: ReviewItem[]) => {
    const ids = runItems.map(i => i.id);
    setActionLoading(new Set(ids));
    try {
      await api.post('/api/review-items/bulk-reject', { ids });
      await load();
    } catch {
      setError('Reject all in run failed.');
    } finally {
      setActionLoading(new Set());
    }
  };

  // --- Selection ---

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(i => i.id)));
    }
  };

  const toggleReasoning = (id: string) => {
    setExpandedReasoning(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startEditing = (item: ReviewItem) => {
    setEditingId(item.id);
    setEditPayload(JSON.stringify(item.reviewPayloadJson.proposedPayload, null, 2));
  };

  // --- Grouping ---

  const groupedByRun = (): RunGroup[] => {
    const map = new Map<string, RunGroup>();
    const ungrouped: ReviewItem[] = [];

    for (const item of items) {
      if (item.agentRunId) {
        if (!map.has(item.agentRunId)) {
          map.set(item.agentRunId, {
            agentRunId: item.agentRunId,
            agentName: item.reviewPayloadJson.agentName ?? 'Unknown Agent',
            items: [],
          });
        }
        map.get(item.agentRunId)!.items.push(item);
      } else {
        ungrouped.push(item);
      }
    }

    const groups = Array.from(map.values());
    if (ungrouped.length > 0) {
      groups.push({
        agentRunId: '__ungrouped__',
        agentName: 'Ungrouped',
        items: ungrouped,
      });
    }
    return groups;
  };

  // --- Renderers ---

  const formatActionType = (type: string) => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  const actionTypeBadgeColor = (type: string): { bg: string; text: string } => {
    switch (type) {
      case 'send_email': return { bg: '#dbeafe', text: '#1e40af' };
      case 'update_record': return { bg: '#dcfce7', text: '#166534' };
      case 'create_record': return { bg: '#e0e7ff', text: '#3730a3' };
      case 'delete_record': return { bg: '#fee2e2', text: '#991b1b' };
      default: return { bg: '#f1f5f9', text: '#475569' };
    }
  };

  const renderProposedPayload = (item: ReviewItem) => {
    const payload = item.reviewPayloadJson.proposedPayload;
    const actionType = item.reviewPayloadJson.actionType;

    if (actionType === 'send_email' && payload) {
      const p = payload as Record<string, unknown>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!!p.to && (
            <div style={{ fontSize: 13 }}>
              <span style={{ color: '#64748b', fontWeight: 500 }}>To: </span>
              <span style={{ color: '#0f172a' }}>{String(p.to)}</span>
            </div>
          )}
          {!!p.subject && (
            <div style={{ fontSize: 13 }}>
              <span style={{ color: '#64748b', fontWeight: 500 }}>Subject: </span>
              <span style={{ color: '#0f172a', fontWeight: 500 }}>{String(p.subject)}</span>
            </div>
          )}
          {!!p.body && (
            <div style={{
              fontSize: 13, color: '#374151', background: '#f8fafc',
              padding: '8px 12px', borderRadius: 6, border: '1px solid #e2e8f0',
              whiteSpace: 'pre-wrap', lineHeight: 1.5, maxHeight: 200, overflowY: 'auto',
            }}>
              {String(p.body)}
            </div>
          )}
        </div>
      );
    }

    return (
      <pre style={{
        fontSize: 12, color: '#374151', background: '#f8fafc',
        padding: '8px 12px', borderRadius: 6, border: '1px solid #e2e8f0',
        whiteSpace: 'pre-wrap', lineHeight: 1.4, maxHeight: 200, overflowY: 'auto',
        margin: 0, fontFamily: 'ui-monospace, monospace',
      }}>
        {JSON.stringify(payload, null, 2)}
      </pre>
    );
  };

  const renderItemCard = (item: ReviewItem) => {
    const isEditing = editingId === item.id;
    const isLoading = actionLoading.has(item.id);
    const badgeColor = actionTypeBadgeColor(item.reviewPayloadJson.actionType);
    const isReasoningExpanded = expandedReasoning.has(item.id);

    return (
      <div
        key={item.id}
        style={{
          padding: 16,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          opacity: isLoading ? 0.6 : 1,
          pointerEvents: isLoading ? 'none' : 'auto',
        }}
      >
        {/* Top row: checkbox + badge + meta + actions */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <input
            type="checkbox"
            checked={selectedIds.has(item.id)}
            onChange={() => toggleSelect(item.id)}
            style={{ marginTop: 3, cursor: 'pointer', accentColor: '#6366f1' }}
          />
          <div style={{ flex: 1 }}>
            {/* Action type badge + agent info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{
                display: 'inline-block', padding: '2px 10px', borderRadius: 4,
                fontSize: 12, fontWeight: 600,
                background: badgeColor.bg, color: badgeColor.text,
              }}>
                {formatActionType(item.reviewPayloadJson.actionType)}
              </span>
              {item.reviewPayloadJson.agentName && (
                <span style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>
                  {item.reviewPayloadJson.agentName}
                </span>
              )}
              {item.reviewPayloadJson.runTimestamp && (
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  {new Date(item.reviewPayloadJson.runTimestamp).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              )}
              {item.reviewStatus === 'edited_pending' && (
                <span style={{
                  fontSize: 11, padding: '1px 7px', borderRadius: 9999,
                  background: '#fef3c7', color: '#92400e', fontWeight: 600,
                }}>
                  Edited
                </span>
              )}
              <span style={{ fontSize: 12, color: '#cbd5e1', marginLeft: 'auto' }}>
                {new Date(item.createdAt).toLocaleString(undefined, {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>

            {/* Reasoning (collapsible) */}
            <button
              onClick={() => toggleReasoning(item.id)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, fontSize: 13, color: '#6366f1', fontWeight: 500,
                marginBottom: isReasoningExpanded ? 6 : 10, display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <span style={{ fontSize: 10, transform: isReasoningExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'inline-block' }}>
                &#9654;
              </span>
              Agent Reasoning
            </button>
            {isReasoningExpanded && (
              <div style={{
                fontSize: 13, color: '#475569', background: '#f8fafc',
                padding: '8px 12px', borderRadius: 6, border: '1px solid #e2e8f0',
                marginBottom: 10, lineHeight: 1.5,
              }}>
                {item.reviewPayloadJson.reasoning}
              </div>
            )}

            {/* Proposed payload */}
            {!isEditing && renderProposedPayload(item)}

            {/* Inline editor */}
            {isEditing && (
              <div style={{ marginTop: 8 }}>
                <textarea
                  value={editPayload}
                  onChange={e => setEditPayload(e.target.value)}
                  style={{
                    width: '100%', minHeight: 160, padding: 12, borderRadius: 6,
                    border: '1px solid #6366f1', fontSize: 12, fontFamily: 'ui-monospace, monospace',
                    lineHeight: 1.4, resize: 'vertical', boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {!isEditing ? (
                <>
                  <button onClick={() => handleApprove(item.id)} disabled={isLoading} style={btnApprove}>
                    Approve
                  </button>
                  <button onClick={() => startEditing(item)} disabled={isLoading} style={btnEditApprove}>
                    Edit &amp; Approve
                  </button>
                  <button onClick={() => handleReject(item.id)} disabled={isLoading} style={btnReject}>
                    Reject
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => handleEditApprove(item.id)} disabled={isLoading} style={btnApprove}>
                    Approve with Edits
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    style={{
                      padding: '6px 14px', background: '#f1f5f9', color: '#475569',
                      border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                    }}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- Loading state ---

  if (loading) {
    return (
      <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ height: 28, width: 200, background: '#e2e8f0', borderRadius: 4, marginBottom: 16 }} />
        {[1, 2, 3].map(i => (
          <div key={i} className="skeleton" style={{ height: 120, borderRadius: 8, marginBottom: 12 }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <Link
          to={`/admin/subaccounts/${subaccountId}`}
          style={{ color: '#6366f1', textDecoration: 'none', fontSize: 14, marginBottom: 8, display: 'inline-block' }}
        >
          &larr; Back to Subaccount
        </Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: '8px 0 4px' }}>
              Review Queue
            </h1>
            <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>
              Approve or reject agent-proposed actions before they execute.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => setGroupByRun(!groupByRun)}
              style={{
                padding: '8px 16px', background: groupByRun ? '#6366f1' : '#f1f5f9',
                color: groupByRun ? '#fff' : '#475569',
                border: groupByRun ? 'none' : '1px solid #e2e8f0',
                borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500,
              }}
            >
              {groupByRun ? 'Grouped by Run' : 'Group by Run'}
            </button>
            <button onClick={load} style={{
              padding: '8px 16px', background: '#f1f5f9', border: '1px solid #e2e8f0',
              borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#475569',
            }}>
              Refresh
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
          {error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b' }}>
            &times;
          </button>
        </div>
      )}

      {/* Bulk actions toolbar */}
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
          background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, marginBottom: 16,
        }}>
          <input
            type="checkbox"
            checked={selectedIds.size === items.length}
            onChange={toggleSelectAll}
            style={{ cursor: 'pointer', accentColor: '#6366f1' }}
          />
          <span style={{ fontSize: 13, color: '#0f172a', fontWeight: 500 }}>
            {selectedIds.size} selected
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={handleBulkApprove} style={btnApprove}>
              Approve Selected
            </button>
            <button onClick={handleBulkReject} style={btnReject}>
              Reject Selected
            </button>
          </div>
        </div>
      )}

      {/* Select-all row when nothing selected yet */}
      {items.length > 0 && selectedIds.size === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={false}
            onChange={toggleSelectAll}
            style={{ cursor: 'pointer', accentColor: '#6366f1' }}
          />
          <span style={{ fontSize: 13, color: '#64748b' }}>
            Select all ({items.length} item{items.length !== 1 ? 's' : ''})
          </span>
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <div style={{
          padding: 60, textAlign: 'center', background: '#fff',
          border: '1px solid #e2e8f0', borderRadius: 12,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, marginBottom: 16, margin: '0 auto 16px',
            background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 16, color: '#0f172a' }}>
            No pending review items
          </p>
          <p style={{ margin: 0, fontSize: 13.5, color: '#64748b' }}>
            When agents propose actions that require approval, they will appear here.
          </p>
        </div>
      )}

      {/* Flat list */}
      {!groupByRun && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map(item => renderItemCard(item))}
        </div>
      )}

      {/* Grouped by run */}
      {groupByRun && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {groupedByRun().map(group => (
            <div key={group.agentRunId} style={{
              border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden',
            }}>
              {/* Group header */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                    {group.agentName}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: '#6366f1',
                    background: '#e0e7ff', padding: '1px 8px', borderRadius: 10,
                  }}>
                    {group.items.length} action{group.items.length !== 1 ? 's' : ''}
                  </span>
                  {group.agentRunId !== '__ungrouped__' && (
                    <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'ui-monospace, monospace' }}>
                      {group.agentRunId.substring(0, 8)}...
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleApproveRun(group.items)} style={btnApprove}>
                    Approve All in Run
                  </button>
                  <button onClick={() => handleRejectRun(group.items)} style={btnReject}>
                    Reject All in Run
                  </button>
                </div>
              </div>
              {/* Group items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {group.items.map((item, idx) => (
                  <div key={item.id} style={{
                    borderBottom: idx < group.items.length - 1 ? '1px solid #f1f5f9' : 'none',
                  }}>
                    {renderItemCard(item)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Button styles ---

const btnApprove: React.CSSProperties = {
  padding: '6px 14px',
  background: '#16a34a',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};

const btnEditApprove: React.CSSProperties = {
  padding: '6px 14px',
  background: '#f1f5f9',
  color: '#475569',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};

const btnReject: React.CSSProperties = {
  padding: '6px 14px',
  background: '#fee2e2',
  color: '#dc2626',
  border: '1px solid #fecaca',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};
