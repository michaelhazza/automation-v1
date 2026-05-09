import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../lib/api';
import StatusPill from '../../components/support/StatusPill';
import PriorityPill from '../../components/support/PriorityPill';
import ThreadMessage from '../../components/support/ThreadMessage';
import DraftOverlayMessage from '../../components/support/DraftOverlayMessage';
import QuarantineBanner from '../../components/support/QuarantineBanner';
import CollisionCallout from '../../components/support/CollisionCallout';

interface Ticket {
  id: string;
  externalId: string;
  subject: string | null;
  status: string;
  priority: string | null;
  assigneeExternalId: string | null;
  inboxId: string;
}

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  visibility: 'public' | 'internal';
  body: string;
  authorName?: string | null;
  createdAtExternal: string;
}

interface DraftOverlay {
  id: string;
  status: string;
  proposedBodyText: string;
  createdAt: string;
  preflightFailureReason?: string | null;
}

interface ThreadData {
  ticket: Ticket;
  messages: Message[];
  draftOverlay: DraftOverlay | null;
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ThreadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    api.get<ThreadData>(`/api/support/tickets/${id}`)
      .then(({ data: d }) => setData(d))
      .catch(() => setError('Failed to load ticket.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  const handleApprove = async (overrideCollision = false) => {
    if (!data?.draftOverlay) return;
    setActionLoading(true);
    try {
      await api.post(`/api/support/drafts/${data.draftOverlay.id}/approve`, { overrideCollision });
      load();
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!data?.draftOverlay) return;
    setActionLoading(true);
    try {
      await api.post(`/api/support/drafts/${data.draftOverlay.id}/reject`, { reason: 'Rejected from ticket view' });
      load();
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-16">
        <div className="w-7 h-7 border-[3px] border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return <div className="px-6 py-4 text-sm text-red-600">{error ?? 'Ticket not found.'}</div>;
  }

  const { ticket, messages, draftOverlay } = data;
  const isQuarantined = ticket.status === 'unknown_provider_status';
  const hasCollision = draftOverlay?.preflightFailureReason === 'human_collision_blocked';

  return (
    <div className="flex flex-col h-full">
      {isQuarantined && <QuarantineBanner ticketId={ticket.externalId} />}

      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
          <Link to="/support/tickets" className="hover:text-indigo-600">Tickets</Link>
          <span>/</span>
          <span className="text-slate-900">{ticket.subject ?? '(no subject)'}</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <StatusPill status={ticket.status} />
          {ticket.priority && <PriorityPill priority={ticket.priority} />}
          <span className="text-xs text-slate-400">#{ticket.externalId}</span>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Thread */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.map(msg => (
            <ThreadMessage
              key={msg.id}
              direction={msg.direction}
              visibility={msg.visibility}
              body={msg.body}
              authorName={msg.authorName}
              createdAt={msg.createdAtExternal}
            />
          ))}
          {draftOverlay && (
            <DraftOverlayMessage
              status={draftOverlay.status}
              proposedBodyText={draftOverlay.proposedBodyText}
              createdAt={draftOverlay.createdAt}
            />
          )}
        </div>

        {/* Action bar */}
        {draftOverlay && ['draft', 'awaiting_review'].includes(draftOverlay.status) && (
          <div className="w-72 border-l border-slate-200 bg-white p-4 flex flex-col gap-3">
            <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Draft Review</p>
            {hasCollision && (
              <CollisionCallout
                message="A human agent may have already replied to this ticket."
                onOverride={() => handleApprove(true)}
                overriding={actionLoading}
              />
            )}
            {!hasCollision && (
              <button
                onClick={() => handleApprove()}
                disabled={actionLoading || isQuarantined}
                className="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                Approve and Send
              </button>
            )}
            <button
              onClick={handleReject}
              disabled={actionLoading}
              className="w-full px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
