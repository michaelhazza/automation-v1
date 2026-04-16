// ---------------------------------------------------------------------------
// SubaccountScheduleCalendarPage
// ---------------------------------------------------------------------------
//
// Feature 1 (docs/routines-response-dev-spec.md §3.4). Subaccount-scoped
// calendar page. Fetches `/api/subaccounts/:subaccountId/schedule-calendar`
// for the selected window and hands the payload to `<ScheduleCalendar>`.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../lib/api';
import ScheduleCalendar, {
  type ScheduleCalendarResponse,
  type ScheduleOccurrence,
} from '../components/ScheduleCalendar';

function isoOffsetDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function isoStartOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const WINDOWS: Array<{ label: string; days: number }> = [
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
];

export default function SubaccountScheduleCalendarPage({
  user: _user,
}: {
  user: { id: string; role: string };
}) {
  const navigate = useNavigate();
  const { subaccountId } = useParams<{ subaccountId: string }>();

  const [windowDays, setWindowDays] = useState<number>(7);
  const [data, setData] = useState<ScheduleCalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { startISO, endISO } = useMemo(
    () => ({ startISO: isoStartOfToday(), endISO: isoOffsetDays(windowDays) }),
    [windowDays]
  );

  useEffect(() => {
    if (!subaccountId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api.get<ScheduleCalendarResponse>(
          `/api/subaccounts/${subaccountId}/schedule-calendar`,
          { params: { start: startISO, end: endISO } }
        );
        if (!cancelled) setData(res.data);
      } catch (e) {
        const err = e as { response?: { data?: { error?: string; message?: string } } };
        if (!cancelled)
          setError(err.response?.data?.error || err.response?.data?.message || 'Failed to load calendar');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subaccountId, startISO, endISO]);

  const onClick = (occ: ScheduleOccurrence) => {
    if (occ.source === 'scheduled_task' || occ.source === 'playbook') {
      navigate(`/admin/subaccounts/${subaccountId}/scheduled-tasks/${occ.sourceId}`);
    } else if (occ.agentId) {
      // Deep-link to the agent edit page so the admin can edit schedule inline.
      navigate(`/admin/subaccounts/${subaccountId}/agents/${occ.sourceId}/manage`);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Scheduled runs</h1>
          <p className="text-sm text-slate-500">
            Projected next {windowDays} days across heartbeat, cron, scheduled tasks, and playbooks in this subaccount.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 text-xs">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setWindowDays(w.days)}
              className={`rounded px-2.5 py-1 ${
                windowDays === w.days
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <ScheduleCalendar
        data={data}
        loading={loading}
        error={error}
        onOccurrenceClick={onClick}
        showSubaccountColumn={false}
      />
    </div>
  );
}
