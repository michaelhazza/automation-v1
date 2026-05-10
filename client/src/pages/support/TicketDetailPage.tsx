import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../lib/api';
import StatusPill from '../../components/support/StatusPill';
import PriorityPill from '../../components/support/PriorityPill';
import ThreadMessage from '../../components/support/ThreadMessage';
import DraftOverlayMessage from '../../components/support/DraftOverlayMessage';
import QuarantineBanner from '../../components/support/QuarantineBanner';

interface Ticket {
  id: string;
  externalId: string;
  subject: string | null;
  status: string;
  priority: string | null;
  assigneeExternalId: string | null;
  inboxId: string;
  contactId?: string | null;
}

interface MessageAttachment {
  externalId: string;
  filename: string;
  providerUrl: string | null;
  mimeType?: string;
  size?: number;
}

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  visibility: 'public' | 'internal';
  body: string;
  authorName?: string | null;
  createdAtExternal: string;
  attachments?: MessageAttachment[] | null;
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
  draftOverlay: DraftOverlay[];
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ThreadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasOverrideCollisionPerm, setHasOverrideCollisionPerm] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    api.get<ThreadData>(`/api/support/tickets/${id}`)
      .then(({ data: d }) => setData(d))
      .catch(() => setError('Failed to load ticket.'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get<{ permissions: string[] }>('/api/my-permissions')
      .then(({ data }) => {
        setHasOverrideCollisionPerm(data.permissions?.includes('support.draft.override_collision') ?? false);
      })
      .catch(() => {
        // permissions fetch failure is non-fatal; default to no override perm
      });
  }, []);

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
  const drafts = Array.isArray(draftOverlay) ? draftOverlay : (draftOverlay ? [draftOverlay] : []);
  const isQuarantined = ticket.status === 'unknown_provider_status';

  void hasOverrideCollisionPerm; // available for future use if inline action bar is re-introduced

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
            <div key={msg.id}>
              <ThreadMessage
                direction={msg.direction}
                visibility={msg.visibility}
                body={msg.body}
                authorName={msg.authorName}
                createdAt={msg.createdAtExternal}
              />
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="ml-4 mb-3 flex flex-wrap gap-2">
                  {msg.attachments.map(att => (
                    <div key={att.externalId} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 border border-slate-200 rounded text-xs text-slate-600">
                      {att.providerUrl ? (
                        <a
                          href={att.providerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-indigo-600 truncate max-w-[160px]"
                        >
                          {att.filename}
                        </a>
                      ) : (
                        <>
                          <span className="text-slate-400 truncate max-w-[120px]">{att.filename}</span>
                          <span className="text-red-500">Couldn&apos;t load</span>
                          <button
                            onClick={load}
                            className="text-indigo-600 hover:underline"
                          >
                            retry
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {drafts.map(draft => (
            <DraftOverlayMessage
              key={draft.id}
              status={draft.status}
              proposedBodyText={draft.proposedBodyText}
              createdAt={draft.createdAt}
            />
          ))}
        </div>

        {/* Right rail — customer identity */}
        <div className="w-56 flex-shrink-0 border-l border-slate-200 bg-white overflow-y-auto p-4">
          <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">Customer</p>
          {ticket.contactId ? (
            <p className="text-xs text-slate-600">Contact: {ticket.contactId}</p>
          ) : (
            <p className="text-xs text-slate-400">Customer not in CRM</p>
          )}

          <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide mt-5 mb-2">Recent tickets</p>
          <p className="text-xs text-slate-400">–</p>
        </div>
      </div>
    </div>
  );
}
