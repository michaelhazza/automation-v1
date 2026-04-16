// ---------------------------------------------------------------------------
// UpcomingWorkCard — compact 7-day scheduled-runs strip for the client portal
// ---------------------------------------------------------------------------
//
// Feature 1 (docs/routines-response-dev-spec.md §3.5). Surfaces the next five
// scheduled occurrences for the active subaccount so the client can see
// "what is the agency doing for me next week" without leaving the portal.
//
// Gated at render time by `subaccount.schedule.view_calendar`. Callers pass
// `hasPermission` — the card renders nothing when the user lacks access so a
// missing permission collapses the grid row cleanly.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import type { ScheduleCalendarResponse, ScheduleOccurrence } from '../ScheduleCalendar';

interface UpcomingWorkCardProps {
  subaccountId: string;
  hasPermission: boolean;
  /** Optional deep link for "view all" — defaults to the portal calendar path. */
  viewAllPath?: string;
}

const SOURCE_LABELS: Record<ScheduleOccurrence['source'], string> = {
  heartbeat: 'Heartbeat',
  cron: 'Cron',
  playbook: 'Playbook',
  scheduled_task: 'Scheduled task',
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `Today · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function UpcomingWorkCard({
  subaccountId,
  hasPermission,
  viewAllPath,
}: UpcomingWorkCardProps) {
  const [items, setItems] = useState<ScheduleOccurrence[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPermission || !subaccountId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setDate(end.getDate() + 7);
        const res = await api.get<ScheduleCalendarResponse>(
          `/api/subaccounts/${subaccountId}/schedule-calendar`,
          { params: { start: start.toISOString(), end: end.toISOString() } }
        );
        if (!cancelled) setItems(res.data.occurrences.slice(0, 5));
      } catch (e) {
        const err = e as { response?: { data?: { error?: string; message?: string } } };
        if (!cancelled)
          setError(err.response?.data?.error || err.response?.data?.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subaccountId, hasPermission]);

  if (!hasPermission) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold uppercase tracking-wider text-slate-500">
            Upcoming work
          </div>
          <div className="text-sm text-slate-700">What your team is doing for you next week</div>
        </div>
        <Link
          to={viewAllPath ?? `/portal/${subaccountId}/schedule-calendar`}
          className="text-xs font-medium text-indigo-600 hover:underline"
        >
          View all →
        </Link>
      </div>

      {loading ? (
        <div className="py-6 text-center text-sm text-slate-400">Loading…</div>
      ) : error ? (
        <div className="py-6 text-center text-sm text-rose-600">{error}</div>
      ) : !items || items.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-400">
          No scheduled work in the next 7 days.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((occ) => (
            <li
              key={occ.occurrenceId}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-slate-800">{occ.sourceName}</div>
                <div className="text-[11px] text-slate-500">
                  {SOURCE_LABELS[occ.source]}
                  {occ.agentName ? ` · ${occ.agentName}` : ''}
                </div>
              </div>
              <div className="shrink-0 text-right font-mono text-[11px] text-slate-600">
                {formatWhen(occ.scheduledAt)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
