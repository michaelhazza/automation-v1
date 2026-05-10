import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import StatusPill from '../../components/support/StatusPill';
import PriorityPill from '../../components/support/PriorityPill';

interface Ticket {
  id: string;
  externalId: string;
  subject: string | null;
  status: string;
  priority: string | null;
  assigneeExternalId: string | null;
  openedAt: string | null;
  lastActivityAt: string | null;
  inboxId: string;
}

interface Inbox {
  syncHealth?: 'running' | 'degraded' | 'failed';
}

type StatusGroup = 'needs_attention' | 'all_open' | 'quarantined' | 'all';

const FILTER_PILLS: { label: string; value: StatusGroup }[] = [
  { label: 'Needs Attention', value: 'needs_attention' },
  { label: 'All Open', value: 'all_open' },
  { label: 'Quarantined', value: 'quarantined' },
  { label: 'All', value: 'all' },
];

export default function TicketsListPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusGroup, setStatusGroup] = useState<StatusGroup>('needs_attention');
  const [quarantinedCount, setQuarantinedCount] = useState<number>(0);
  const [syncHealth, setSyncHealth] = useState<'running' | 'degraded' | 'failed' | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = statusGroup !== 'all' ? `?statusGroup=${statusGroup}` : '';
    api.get<{ tickets: Ticket[] }>(`/api/support/tickets${params}`)
      .then(({ data }) => setTickets(data.tickets ?? []))
      .catch(() => setError('Failed to load tickets.'))
      .finally(() => setLoading(false));
  }, [statusGroup]);

  // Fetch quarantined count when not already viewing quarantined
  useEffect(() => {
    if (statusGroup === 'quarantined') {
      setQuarantinedCount(0);
      return;
    }
    api.get<{ tickets: Ticket[] }>('/api/support/tickets?statusGroup=quarantined')
      .then(({ data }) => setQuarantinedCount((data.tickets ?? []).length))
      .catch(() => { /* non-fatal */ });
  }, [statusGroup]);

  // Fetch inbox sync health
  useEffect(() => {
    api.get<{ inboxes: Inbox[] }>('/api/support/inboxes')
      .then(({ data }) => {
        const inboxes = data.inboxes ?? [];
        if (inboxes.some(i => i.syncHealth === 'failed')) {
          setSyncHealth('failed');
        } else if (inboxes.some(i => i.syncHealth === 'degraded')) {
          setSyncHealth('degraded');
        } else {
          setSyncHealth(null);
        }
      })
      .catch(() => { /* non-fatal */ });
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Sync-health indicator */}
      {syncHealth === 'failed' && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
          Provider connection failed
        </div>
      )}
      {syncHealth === 'degraded' && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-700">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
          Provider sync degraded
        </div>
      )}

      <div className="px-6 pt-5 pb-3 border-b border-slate-200 bg-white">
        <h1 className="text-lg font-semibold text-slate-900 mb-3">Tickets</h1>

        {/* Quarantine count banner */}
        {quarantinedCount > 0 && statusGroup !== 'quarantined' && (
          <div className="flex items-center gap-1 mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <span>
              {quarantinedCount} quarantined ticket{quarantinedCount !== 1 ? 's' : ''}
            </span>
            <button
              onClick={() => setStatusGroup('quarantined')}
              className="ml-1 underline hover:no-underline font-medium"
            >
              Show quarantined
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          {FILTER_PILLS.map(pill => (
            <button
              key={pill.value}
              onClick={() => setStatusGroup(pill.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                statusGroup === pill.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex justify-center items-center py-16">
            <div className="w-7 h-7 border-[3px] border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        )}
        {error && (
          <div className="px-6 py-4 text-sm text-red-600">{error}</div>
        )}
        {!loading && !error && tickets.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <p className="text-sm font-medium">No tickets</p>
          </div>
        )}
        {!loading && !error && tickets.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-6 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Subject</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Priority</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(ticket => (
                <tr
                  key={ticket.id}
                  className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                    ticket.status === 'unknown_provider_status' ? 'bg-red-50 hover:bg-red-100' : ''
                  }`}
                >
                  <td className="px-6 py-3">
                    <Link to={`/support/tickets/${ticket.id}`} className="font-medium text-slate-900 hover:text-indigo-600 block truncate max-w-xs">
                      {ticket.subject ?? '(no subject)'}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <StatusPill status={ticket.status} />
                  </td>
                  <td className="px-3 py-3">
                    {ticket.priority ? <PriorityPill priority={ticket.priority} /> : <span className="text-slate-400 text-xs">-</span>}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {ticket.lastActivityAt ? new Date(ticket.lastActivityAt).toLocaleString() : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
