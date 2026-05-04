import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { User } from '../lib/auth';
import { getAgentCalendar, createAgentCalendarEvent, respondToAgentCalendarEvent } from '../lib/api';

interface CalendarEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  attendeeEmails: string[];
  responseStatus: 'needs_action' | 'accepted' | 'declined' | 'tentative' | null;
  organiserEmail: string | null;
  metadata: Record<string, unknown> | null;
}

function weekBounds() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { from: monday.toISOString(), to: sunday.toISOString() };
}

const RESPONSE_LABEL: Record<string, string> = {
  accepted: 'Accepted',
  declined: 'Declined',
  tentative: 'Tentative',
  needs_action: 'Pending',
};

const RESPONSE_CLS: Record<string, string> = {
  accepted: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
  tentative: 'bg-amber-100 text-amber-700',
  needs_action: 'bg-slate-100 text-slate-600',
};

export default function AgentCalendarPage({ user: _user }: { user: User }) {
  const { subaccountId, agentId } = useParams<{ subaccountId: string; agentId: string }>();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [newAttendees, setNewAttendees] = useState('');
  const [creating, setCreating] = useState(false);
  const [responding, setResponding] = useState(false);

  const { from, to } = weekBounds();

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const data = await getAgentCalendar(agentId, from, to);
      setEvents(data.events ?? []);
    } catch {
      // no identity or no events
    } finally {
      setLoading(false);
    }
  }, [agentId, from, to]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!agentId) return;
    setCreating(true);
    try {
      await createAgentCalendarEvent(agentId, {
        title: newTitle,
        startsAt: new Date(newStart).toISOString(),
        endsAt: new Date(newEnd).toISOString(),
        attendeeEmails: newAttendees.split(',').map(s => s.trim()).filter(Boolean),
      });
      setNewEventOpen(false);
      setNewTitle('');
      setNewStart('');
      setNewEnd('');
      setNewAttendees('');
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function handleRespond(response: 'accepted' | 'declined' | 'tentative') {
    if (!agentId || !selectedEvent) return;
    setResponding(true);
    try {
      await respondToAgentCalendarEvent(agentId, selectedEvent.id, response);
      setSelectedEvent(prev => prev ? { ...prev, responseStatus: response } : prev);
      await load();
    } finally {
      setResponding(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 -mx-6 -my-7">
      {/* Event list */}
      <div className="w-72 border-r border-slate-200 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold text-slate-800">Calendar</div>
            <Link
              to={`/admin/subaccounts/${subaccountId}`}
              className="text-[11px] text-slate-400 hover:text-slate-600 no-underline"
            >
              ← Back
            </Link>
          </div>
          <button
            onClick={() => setNewEventOpen(true)}
            className="px-3 py-1.5 text-[12px] bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            New event
          </button>
        </div>
        <div className="px-4 py-2 text-[11px] text-slate-400 border-b border-slate-100">
          This week
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="px-4 py-4 text-[13px] text-slate-400">Loading…</div>}
          {!loading && events.length === 0 && (
            <div className="px-4 py-8 text-[13px] text-slate-400 text-center">No events this week</div>
          )}
          {events.map((event) => (
            <button
              key={event.id}
              onClick={() => setSelectedEvent(event)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors bg-transparent cursor-pointer ${
                selectedEvent?.id === event.id ? 'bg-indigo-50' : ''
              }`}
            >
              <div className="text-[13px] font-medium text-slate-800 truncate">{event.title}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {new Date(event.startsAt).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
              </div>
              {event.responseStatus && (
                <span className={`mt-1 inline-block text-[10px] px-2 py-0.5 rounded-full font-medium ${RESPONSE_CLS[event.responseStatus] ?? RESPONSE_CLS.needs_action}`}>
                  {RESPONSE_LABEL[event.responseStatus] ?? event.responseStatus}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Event detail */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {!selectedEvent && (
          <div className="flex items-center justify-center h-full text-[14px] text-slate-400">
            Select an event
          </div>
        )}
        {selectedEvent && (
          <div className="max-w-xl">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-[18px] font-semibold text-slate-900">{selectedEvent.title}</h2>
              {selectedEvent.responseStatus && (
                <span className={`text-[12px] px-3 py-1 rounded-full font-medium ${RESPONSE_CLS[selectedEvent.responseStatus] ?? RESPONSE_CLS.needs_action}`}>
                  {RESPONSE_LABEL[selectedEvent.responseStatus] ?? selectedEvent.responseStatus}
                </span>
              )}
            </div>

            <div className="space-y-2 text-[13px] text-slate-700 mb-6">
              <div>
                <span className="text-slate-400 mr-2">When</span>
                {new Date(selectedEvent.startsAt).toLocaleString()} – {new Date(selectedEvent.endsAt).toLocaleString()}
              </div>
              {selectedEvent.organiserEmail && (
                <div>
                  <span className="text-slate-400 mr-2">Organizer</span>
                  {selectedEvent.organiserEmail}
                </div>
              )}
              {selectedEvent.attendeeEmails.length > 0 && (
                <div>
                  <span className="text-slate-400 mr-2">Attendees</span>
                  {selectedEvent.attendeeEmails.join(', ')}
                </div>
              )}
            </div>

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => handleRespond('accepted')}
                disabled={responding}
                className="px-3 py-1.5 text-[13px] bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                Accept
              </button>
              <button
                onClick={() => handleRespond('tentative')}
                disabled={responding}
                className="px-3 py-1.5 text-[13px] bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50"
              >
                Tentative
              </button>
              <button
                onClick={() => handleRespond('declined')}
                disabled={responding}
                className="px-3 py-1.5 text-[13px] border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
              >
                Decline
              </button>
            </div>

            {typeof selectedEvent.metadata?.gcal_event_id === 'string' && (
              <a
                href={`https://calendar.google.com/calendar/event?eid=${selectedEvent.metadata.gcal_event_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-indigo-500 hover:underline"
              >
                Open in Google Calendar →
              </a>
            )}
          </div>
        )}
      </div>

      {/* New event modal */}
      {newEventOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">New calendar event</h2>
            <div className="space-y-3">
              <label className="block text-sm font-medium">
                Title
                <input
                  className="mt-1 block w-full border rounded px-3 py-2 text-sm"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                />
              </label>
              <label className="block text-sm font-medium">
                Start
                <input
                  type="datetime-local"
                  className="mt-1 block w-full border rounded px-3 py-2 text-sm"
                  value={newStart}
                  onChange={e => setNewStart(e.target.value)}
                />
              </label>
              <label className="block text-sm font-medium">
                End
                <input
                  type="datetime-local"
                  className="mt-1 block w-full border rounded px-3 py-2 text-sm"
                  value={newEnd}
                  onChange={e => setNewEnd(e.target.value)}
                />
              </label>
              <label className="block text-sm font-medium">
                Attendees (comma-separated emails)
                <input
                  className="mt-1 block w-full border rounded px-3 py-2 text-sm"
                  value={newAttendees}
                  onChange={e => setNewAttendees(e.target.value)}
                  placeholder="alice@example.com, bob@example.com"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setNewEventOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newTitle || !newStart || !newEnd}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
