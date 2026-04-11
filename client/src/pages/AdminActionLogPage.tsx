/**
 * AdminActionLogPage.tsx
 *
 * Per-subaccount audit log of agent actions. Lists actions filtered by
 * status, with click-to-expand rows showing the action's payload, result,
 * and full event timeline.
 *
 * Backend:
 *   GET /api/subaccounts/:subaccountId/actions?status=...
 *   GET /api/actions/:id/events
 *
 * Permission: org.workspace.view (matches the route).
 */

import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import { relativeTime } from '../lib/relativeTime';

interface Action {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  agentId: string;
  agentRunId: string | null;
  actionType: string;
  actionCategory: 'api' | 'worker' | 'browser' | 'devops' | 'mcp';
  gateLevel: 'auto' | 'review' | 'block';
  status:
    | 'proposed'
    | 'pending_approval'
    | 'approved'
    | 'executing'
    | 'completed'
    | 'failed'
    | 'rejected'
    | 'blocked'
    | 'skipped';
  payloadJson: unknown;
  resultJson: unknown;
  errorJson: unknown;
  retryCount: number;
  maxRetries: number;
  rejectionComment: string | null;
  approvedAt: string | null;
  executedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ActionEvent {
  id: string;
  actionId: string;
  eventType:
    | 'created'
    | 'validation_failed'
    | 'queued_for_review'
    | 'approved'
    | 'edited_and_approved'
    | 'rejected'
    | 'execution_started'
    | 'execution_completed'
    | 'execution_failed'
    | 'retry_scheduled'
    | 'blocked'
    | 'skipped_duplicate';
  actorId: string | null;
  metadataJson: Record<string, unknown> | null;
  createdAt: string;
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'executing', label: 'Executing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'skipped', label: 'Skipped' },
];

const STATUS_PILL: Record<Action['status'], string> = {
  proposed: 'bg-slate-100 text-slate-700 border-slate-200',
  pending_approval: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-blue-50 text-blue-700 border-blue-200',
  executing: 'bg-violet-50 text-violet-700 border-violet-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  blocked: 'bg-red-50 text-red-700 border-red-200',
  skipped: 'bg-slate-50 text-slate-500 border-slate-200',
};

const GATE_PILL: Record<Action['gateLevel'], string> = {
  auto: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  review: 'bg-amber-50 text-amber-700 border-amber-200',
  block: 'bg-red-50 text-red-700 border-red-200',
};

const EVENT_LABEL: Record<ActionEvent['eventType'], string> = {
  created: 'Created',
  validation_failed: 'Validation failed',
  queued_for_review: 'Queued for review',
  approved: 'Approved',
  edited_and_approved: 'Edited & approved',
  rejected: 'Rejected',
  execution_started: 'Execution started',
  execution_completed: 'Execution completed',
  execution_failed: 'Execution failed',
  retry_scheduled: 'Retry scheduled',
  blocked: 'Blocked',
  skipped_duplicate: 'Skipped (duplicate)',
};

function JsonBlock({ data }: { data: unknown }) {
  if (data == null) return null;
  let formatted: string;
  try {
    formatted = JSON.stringify(data, null, 2);
  } catch {
    formatted = String(data);
  }
  return (
    <pre className="bg-slate-900 text-slate-200 px-3 py-2 rounded-md text-[11.5px] overflow-auto whitespace-pre-wrap break-words leading-relaxed font-mono max-h-[260px]">
      {formatted}
    </pre>
  );
}

export default function AdminActionLogPage({ user: _user }: { user: User }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [eventsByAction, setEventsByAction] = useState<Record<string, ActionEvent[]>>({});
  const [eventsLoading, setEventsLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!subaccountId) return;
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const res = await api.get<Action[]>(`/api/subaccounts/${subaccountId}/actions`, { params });
      setActions(res.data ?? []);
      setError(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message ?? 'Failed to load actions');
    } finally {
      setLoading(false);
    }
  }, [subaccountId, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const toggleExpand = useCallback(async (actionId: string) => {
    if (expandedId === actionId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(actionId);
    if (eventsByAction[actionId]) return;
    setEventsLoading(actionId);
    try {
      const res = await api.get<ActionEvent[]>(`/api/actions/${actionId}/events`);
      setEventsByAction((prev) => ({ ...prev, [actionId]: res.data ?? [] }));
    } catch {
      setEventsByAction((prev) => ({ ...prev, [actionId]: [] }));
    } finally {
      setEventsLoading(null);
    }
  }, [expandedId, eventsByAction]);

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both] max-w-[1100px] mx-auto">
      <div className="mb-4 text-[13px] text-slate-500 flex items-center gap-1.5">
        <Link to={`/admin/subaccounts/${subaccountId}/workspace`} className="text-indigo-600 hover:text-indigo-700 no-underline font-medium">Workspace</Link>
        <span>/</span>
        <span>Action log</span>
      </div>

      <div className="mb-5">
        <h1 className="text-[26px] font-extrabold text-slate-900 tracking-tight m-0">Action Log</h1>
        <p className="text-[13.5px] text-slate-500 mt-1">Audit trail of agent actions, approvals, and executions in this workspace.</p>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <label className="text-[12.5px] text-slate-500 font-medium">Status:</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-[13px] border border-slate-200 rounded-md px-2.5 py-1.5 bg-white"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void load()}
          className="text-[12.5px] font-semibold px-3 py-1.5 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-[13px] text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
          ))}
        </div>
      ) : actions.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl p-10 text-center">
          <div className="text-[15px] text-slate-700 font-semibold mb-1">No actions found</div>
          <div className="text-[13px] text-slate-500">{statusFilter ? 'Try changing the status filter.' : 'No actions have been proposed in this workspace yet.'}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {actions.map((action) => {
            const isExpanded = expandedId === action.id;
            const events = eventsByAction[action.id] ?? [];
            return (
              <div key={action.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => void toggleExpand(action.id)}
                  className="w-full text-left p-3.5 flex items-center gap-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${STATUS_PILL[action.status]}`}>
                        {action.status.replace('_', ' ')}
                      </span>
                      <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${GATE_PILL[action.gateLevel]}`}>
                        {action.gateLevel}
                      </span>
                      <span className="text-[10.5px] text-slate-400 font-mono">{action.actionCategory}</span>
                      {action.retryCount > 0 && (
                        <span className="text-[10.5px] text-amber-600 font-semibold">retry {action.retryCount}/{action.maxRetries}</span>
                      )}
                    </div>
                    <div className="text-[14px] font-semibold text-slate-800 truncate">{action.actionType}</div>
                    <div className="text-[11.5px] text-slate-500 mt-0.5 flex gap-2 flex-wrap">
                      <span>{relativeTime(action.createdAt)}</span>
                      {action.agentRunId && (
                        <Link
                          to={`/admin/subaccounts/${subaccountId}/runs/${action.agentRunId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-indigo-600 hover:text-indigo-700 no-underline font-medium"
                        >
                          View run →
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="text-slate-400 text-[18px] shrink-0">{isExpanded ? '−' : '+'}</div>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 px-3.5 py-3 bg-slate-50">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider mb-1">Payload</div>
                        <JsonBlock data={action.payloadJson} />
                      </div>
                      {action.resultJson != null && (
                        <div>
                          <div className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider mb-1">Result</div>
                          <JsonBlock data={action.resultJson} />
                        </div>
                      )}
                      {action.errorJson != null && (
                        <div className="md:col-span-2">
                          <div className="text-[10.5px] font-bold text-red-500 uppercase tracking-wider mb-1">Error</div>
                          <JsonBlock data={action.errorJson} />
                        </div>
                      )}
                      {action.rejectionComment && (
                        <div className="md:col-span-2 bg-red-50 border border-red-200 rounded-md p-2 text-[12.5px] text-red-700">
                          <span className="font-semibold">Rejection comment:</span> {action.rejectionComment}
                        </div>
                      )}
                    </div>

                    <div className="mt-4">
                      <div className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider mb-2">Event timeline</div>
                      {eventsLoading === action.id ? (
                        <div className="text-[12px] text-slate-400 italic">Loading events…</div>
                      ) : events.length === 0 ? (
                        <div className="text-[12px] text-slate-400 italic">No events recorded.</div>
                      ) : (
                        <ol className="flex flex-col gap-1.5">
                          {events.map((evt) => (
                            <li key={evt.id} className="flex items-start gap-2 text-[12px]">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <span className="font-semibold text-slate-700">{EVENT_LABEL[evt.eventType] ?? evt.eventType}</span>
                                <span className="text-slate-400 ml-2">{relativeTime(evt.createdAt)}</span>
                                {evt.metadataJson && Object.keys(evt.metadataJson).length > 0 && (
                                  <div className="mt-1"><JsonBlock data={evt.metadataJson} /></div>
                                )}
                              </div>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
