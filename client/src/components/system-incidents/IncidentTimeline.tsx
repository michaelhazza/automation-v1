export interface IncidentEvent {
  id: string;
  eventType: string;
  actorKind: string;
  actorId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export function IncidentTimeline({ events, loading }: { events: IncidentEvent[]; loading: boolean }) {
  return (
    <div>
      <h3 className="text-[12px] font-semibold text-slate-600 uppercase tracking-wide mb-2">Timeline</h3>
      {loading ? (
        <div className="text-slate-400 text-[12px]">Loading...</div>
      ) : events.length === 0 ? (
        <div className="text-slate-400 text-[12px]">No events</div>
      ) : (
        <div className="space-y-2">
          {events.map((ev) => (
            <div key={ev.id} className="flex gap-2 text-[12px]">
              <div className="w-28 text-slate-500 shrink-0">{new Date(ev.occurredAt).toLocaleTimeString()}</div>
              <div>
                <span className="font-medium text-slate-700">{ev.eventType}</span>
                <span className="text-slate-500 ml-1">({ev.actorKind})</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
