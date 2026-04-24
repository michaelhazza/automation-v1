import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { formatDuration } from '../lib/formatDuration';
import { trackActivityLogViewed, trackRunLogOpened } from '../lib/telemetry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActivityType =
  | 'agent_run'
  | 'review_item'
  | 'health_finding'
  | 'inbox_item'
  | 'workflow_run'
  | 'workflow_execution';

type TriggerType = 'manual' | 'scheduled' | 'webhook' | 'agent' | 'system';

type NormalisedStatus =
  | 'active'
  | 'attention_needed'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface ActivityItem {
  id: string;
  type: ActivityType;
  status: NormalisedStatus;
  subject: string;
  actor: string;
  subaccountId: string | null;
  subaccountName: string | null;
  agentId: string | null;
  agentName: string | null;
  severity: 'critical' | 'warning' | 'info' | null;
  createdAt: string;
  updatedAt: string;
  detailUrl: string;
  // Task 1.3 additive fields
  triggeredByUserId: string | null;
  triggeredByUserName: string | null;
  triggerType: TriggerType | null;
  durationMs: number | null;
  runId: string | null;
}

export interface UnifiedActivityFeedProps {
  orgId: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Column visibility: computed once from the first fetch, never re-evaluated
// ---------------------------------------------------------------------------

interface ColumnVisibility {
  duration: boolean;
}

/**
 * Evaluate column visibility from the first batch of items.
 * §4.2: omit the whole column for the session if fewer than 80 % of
 * applicable rows populate it.
 *
 * "Applicable rows" for `duration` are agent_run and workflow_execution.
 */
function computeColumnVisibility(items: ActivityItem[]): ColumnVisibility {
  const applicable = items.filter(
    (i) => i.type === 'agent_run' || i.type === 'workflow_execution',
  );
  if (applicable.length === 0) {
    return { duration: false };
  }
  const populated = applicable.filter((i) => i.durationMs != null).length;
  return { duration: populated / applicable.length >= 0.8 };
}

// ---------------------------------------------------------------------------
// Helpers — actor rendering (§4.4)
// ---------------------------------------------------------------------------

function InitialAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold shrink-0">
      {initials}
    </span>
  );
}

function AgentPill({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-[11px] font-semibold text-indigo-700">
      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />
      {name}
    </span>
  );
}

/**
 * Pure helper — covers all four actor rendering cases per §4.4.
 */
function renderActor(item: ActivityItem): JSX.Element {
  // Case 1: human actor on review/inbox items
  if (
    item.triggeredByUserId != null &&
    (item.type === 'review_item' || item.type === 'inbox_item')
  ) {
    const name = item.triggeredByUserName ?? item.actor;
    return (
      <span className="flex items-center gap-1.5">
        <InitialAvatar name={name} />
        <span className="text-[13px] text-slate-700">{name}</span>
      </span>
    );
  }

  // Case 2: manual trigger with a known user — human avatar + agent name secondary
  if (item.triggerType === 'manual' && item.triggeredByUserId != null) {
    const userName = item.triggeredByUserName ?? item.actor;
    const agentLabel = item.agentName;
    return (
      <span className="flex items-center gap-1.5">
        <InitialAvatar name={userName} />
        <span className="flex flex-col leading-tight">
          <span className="text-[13px] text-slate-700">{userName}</span>
          {agentLabel && (
            <span className="text-[11px] text-slate-400">{agentLabel}</span>
          )}
        </span>
      </span>
    );
  }

  // Case 3: agent-driven
  if (item.agentName != null) {
    const triggerLabel =
      item.triggerType != null
        ? item.triggerType.charAt(0).toUpperCase() + item.triggerType.slice(1)
        : null;
    return (
      <span className="flex flex-col gap-0.5">
        <AgentPill name={item.agentName} />
        {triggerLabel && (
          <span className="text-[11px] text-slate-400 pl-0.5">{triggerLabel}</span>
        )}
      </span>
    );
  }

  // Case 4: fallback — system / unknown (agentName is null here; Case 3 exits earlier)
  const actorLabel = item.actor;
  return (
    <span className="text-[13px] text-slate-500 italic">
      System · {actorLabel}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: NormalisedStatus }) {
  const map: Record<NormalisedStatus, { bg: string; text: string }> = {
    active: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
    attention_needed: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700' },
    completed: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
    failed: { bg: 'bg-red-50 border-red-200', text: 'text-red-700' },
    cancelled: { bg: 'bg-slate-50 border-slate-200', text: 'text-slate-500' },
  };
  const { bg, text } = map[status];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-full border ${bg} ${text}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skeleton rows
// ---------------------------------------------------------------------------

const shimmer =
  'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded-md';

function SkeletonRow({ colCount }: { colCount: number }) {
  return (
    <tr>
      {Array.from({ length: colCount }, (_, i) => (
        <td key={i} className="px-4 py-3">
          <div className={`h-4 ${shimmer} ${i === 0 ? 'w-3/4' : 'w-1/2'}`} />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Relative time helper
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function UnifiedActivityFeed({
  orgId: _orgId,
  limit = 20,
}: UnifiedActivityFeedProps) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Column visibility is locked after first fetch — never recomputed on pagination
  const [colVis, setColVis] = useState<ColumnVisibility | null>(null);
  const colVisLocked = useRef(false);
  const telemetryFired = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchActivity() {
      try {
        setLoading(true);
        const { data } = await api.get<{ items: ActivityItem[]; total: number }>(
          '/api/activity',
          { params: { limit, sort: 'newest' } },
        );
        if (cancelled) return;

        const fetched: ActivityItem[] = data.items ?? [];
        setItems(fetched);

        // Lock column visibility once — never re-evaluate on subsequent loads (§4.2)
        if (!colVisLocked.current) {
          colVisLocked.current = true;
          setColVis(computeColumnVisibility(fetched));
        }

        // Telemetry: activity log viewed — fire once on first successful fetch only
        if (!telemetryFired.current) {
          telemetryFired.current = true;
          const typesPresent = [...new Set(fetched.map((i) => i.type))];
          trackActivityLogViewed({ rowCount: fetched.length, typesPresent });
        }
      } catch {
        // §2.6: silent error — render empty state
        if (!cancelled) {
          setItems([]);
          if (!colVisLocked.current) {
            colVisLocked.current = true;
            setColVis({ duration: false });
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchActivity();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  // Determine table columns: Activity / Executed by / Status / Duration / When
  // Duration column is gated by colVis
  const showDuration = colVis?.duration ?? false;

  // Total column count for skeleton
  const colCount = 4 + (showDuration ? 1 : 0);

  // Loading state — show 4 skeleton rows
  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Activity</th>
              <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Executed by</th>
              <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Status</th>
              <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonRow key={i} colCount={colCount} />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Empty state
  if (items.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-10 text-center">
        <p className="text-[14px] text-slate-400">No activity yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Activity</th>
            <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Executed by</th>
            <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Status</th>
            {showDuration && (
              <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Duration</th>
            )}
            <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {items.map((item) => {
            // §4.5: Log link only for agent_run / workflow_execution with non-null runId
            const showLogLink =
              (item.type === 'agent_run' || item.type === 'workflow_execution') &&
              item.runId != null;

            return (
              <tr key={`${item.type}-${item.id}`} className="hover:bg-slate-50 transition-colors">
                {/* Activity column */}
                <td className="px-4 py-3 max-w-[280px]">
                  <span className="text-[13px] text-slate-800 font-medium line-clamp-1">
                    {item.subject.length > 80
                      ? item.subject.slice(0, 80) + '…'
                      : item.subject}
                  </span>
                  {showLogLink && (
                    <Link
                      to={`/runs/${item.runId}/live`}
                      className="mt-0.5 inline-block text-[11.5px] text-indigo-600 hover:text-indigo-700 no-underline hover:underline"
                      onClick={() => {
                        trackRunLogOpened({
                          runId: item.runId!,
                          activityType: item.type,
                          triggerType: item.triggerType,
                        });
                      }}
                    >
                      View log →
                    </Link>
                  )}
                </td>

                {/* Executed by column */}
                <td className="px-4 py-3">{renderActor(item)}</td>

                {/* Status column */}
                <td className="px-4 py-3">
                  <StatusBadge status={item.status} />
                </td>

                {/* Duration column (conditional) */}
                {showDuration && (
                  <td className="px-4 py-3 text-[13px] text-slate-500 tabular-nums">
                    {formatDuration(item.durationMs)}
                  </td>
                )}

                {/* When column */}
                <td className="px-4 py-3 text-[13px] text-slate-400 whitespace-nowrap">
                  {relativeTime(item.createdAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
