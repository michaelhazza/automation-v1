import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import StatusPill from '../../components/support/StatusPill';
import PriorityPill from '../../components/support/PriorityPill';
import QuarantineBanner from '../../components/support/QuarantineBanner';

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

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = statusGroup !== 'all' ? `?statusGroup=${statusGroup}` : '';
    api.get<{ tickets: Ticket[] }>(`/api/support/tickets${params}`)
      .then(({ data }) => setTickets(data.tickets ?? []))
      .catch(() => setError('Failed to load tickets.'))
      .finally(() => setLoading(false));
  }, [statusGroup]);

  const hasQuarantined = tickets.some(t => t.status === 'unknown_provider_status');

  return (
    <div className="flex flex-col h-full">
      {hasQuarantined && statusGroup === 'quarantined' && <QuarantineBanner />}

      <div className="px-6 pt-5 pb-3 border-b border-slate-200 bg-white">
        <h1 className="text-lg font-semibold text-slate-900 mb-3">Tickets</h1>
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
