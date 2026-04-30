import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import ActivityFeedTable, { ActivityItem } from '../activity/ActivityFeedTable';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentActivityTabProps {
  agentId: string;
  actorId: string;       // workspace_actors.id — the stable identifier
  subaccountId: string;
  agentName?: string;    // optional display name for the lock badge
}

type DateRange = 'last_30_days' | 'last_7_days' | 'last_24_hours';

type EventTypeGroup = 'all' | 'email' | 'calendar' | 'agent_runs' | 'identity_lifecycle';

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_24_hours', label: 'Last 24 hours' },
];

const EVENT_TYPE_OPTIONS: { value: EventTypeGroup; label: string }[] = [
  { value: 'all', label: 'All actions' },
  { value: 'email', label: 'Email' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'agent_runs', label: 'Agent runs' },
  { value: 'identity_lifecycle', label: 'Identity lifecycle' },
];

// Map event type group to the concrete type strings used by the activity API
const EVENT_TYPE_GROUP_MAP: Record<EventTypeGroup, string[] | null> = {
  all: null,
  email: ['email.sent', 'email.received'],
  calendar: ['calendar.event_created', 'calendar.event_accepted', 'calendar.event_declined'],
  agent_runs: ['agent_run', 'workflow_run', 'workflow_execution'],
  identity_lifecycle: [
    'identity.provisioned', 'identity.activated', 'identity.suspended',
    'identity.resumed', 'identity.revoked', 'identity.archived',
    'identity.email_sending_enabled', 'identity.email_sending_disabled',
    'identity.migrated', 'identity.migration_failed', 'identity.provisioning_failed',
    'actor.onboarded',
  ],
};

function dateRangeToAfter(range: DateRange): string {
  const now = new Date();
  if (range === 'last_24_hours') {
    now.setHours(now.getHours() - 24);
  } else if (range === 'last_7_days') {
    now.setDate(now.getDate() - 7);
  } else {
    now.setDate(now.getDate() - 30);
  }
  return now.toISOString();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AgentActivityTab({ agentId: _agentId, actorId, subaccountId, agentName }: AgentActivityTabProps) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  // DE-CR-7: cursor-based pagination — `null` means no further page exists.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [dateRange, setDateRange] = useState<DateRange>('last_30_days');
  const [eventTypeGroup, setEventTypeGroup] = useState<EventTypeGroup>('all');

  const LIMIT = 50;

  const fetchItems = useCallback(async (reset: boolean, cursor: string | null) => {
    setLoading(true);
    setFetchError(null);

    const params: Record<string, string> = {
      actorId,
      limit: String(LIMIT),
      from: dateRangeToAfter(dateRange),
    };
    if (!reset && cursor) params.cursor = cursor;

    const types = EVENT_TYPE_GROUP_MAP[eventTypeGroup];
    if (types) {
      params['type'] = types.join(',');
    }

    try {
      const res = await api.get(`/api/subaccounts/${subaccountId}/activity`, { params });
      const data = res.data as { items: ActivityItem[]; nextCursor: string | null };
      const fetched: ActivityItem[] = data.items ?? [];
      setItems(prev => reset ? fetched : [...prev, ...fetched]);
      setNextCursor(data.nextCursor ?? null);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } | string } }; message?: string };
      const apiErr = err.response?.data?.error;
      const msg = typeof apiErr === 'string' ? apiErr : apiErr?.message;
      setFetchError(msg ?? err.message ?? 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [actorId, subaccountId, dateRange, eventTypeGroup]);

  // Reset and fetch when filters change
  useEffect(() => {
    setNextCursor(null);
    setItems([]);
    fetchItems(true, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId, subaccountId, dateRange, eventTypeGroup]);

  function handleLoadMore() {
    if (nextCursor) fetchItems(false, nextCursor);
  }

  function handleRefresh() {
    setNextCursor(null);
    setItems([]);
    fetchItems(true, null);
  }

  const lockLabel = agentName ? `${agentName} only` : 'This agent only';

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border border-slate-200 rounded-lg mb-4 flex-wrap">
        <span className="text-[13px] font-medium text-slate-700">Filter</span>

        <select
          value={dateRange}
          onChange={e => setDateRange(e.target.value as DateRange)}
          className="text-[12px] border border-slate-200 rounded-md px-2 py-1 bg-white outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 cursor-pointer"
        >
          {DATE_RANGE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <select
          value={eventTypeGroup}
          onChange={e => setEventTypeGroup(e.target.value as EventTypeGroup)}
          className="text-[12px] border border-slate-200 rounded-md px-2 py-1 bg-white outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 cursor-pointer"
        >
          {EVENT_TYPE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Lock badge */}
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-[11px] font-medium">
          {lockLabel}
          <span className="text-indigo-400 font-normal">(locked)</span>
        </span>

        {/* Refresh */}
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="ml-auto text-[12px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-md px-3 py-1 bg-white disabled:opacity-50 cursor-pointer"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Error state */}
      {fetchError && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
          {fetchError}
        </div>
      )}

      {/* Feed */}
      <ActivityFeedTable
        items={items}
        loading={loading}
        hasMore={nextCursor !== null}
        onLoadMore={handleLoadMore}
      />
    </div>
  );
}
