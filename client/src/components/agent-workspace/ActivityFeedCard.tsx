interface FeedEvent {
  eventId: string;
  eventType: string;
  eventTimestamp: string;
  runId: string;
}

interface Props {
  feed: FeedEvent[];
  agentId: string;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function eventTypeBadgeColor(eventType: string): string {
  if (eventType.includes('run_completed') || eventType.includes('success')) {
    return 'bg-green-50 text-green-700';
  }
  if (eventType.includes('run_started') || eventType.includes('start')) {
    return 'bg-blue-50 text-blue-700';
  }
  if (eventType.includes('failed') || eventType.includes('error')) {
    return 'bg-red-50 text-red-700';
  }
  if (eventType.includes('warning') || eventType.includes('degraded')) {
    return 'bg-amber-50 text-amber-700';
  }
  return 'bg-slate-100 text-slate-600';
}

export default function ActivityFeedCard({ feed, agentId }: Props) {
  const rows = feed.slice(0, 5);

  return (
    <div className="bg-white rounded-lg border border-slate-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-slate-700">Activity</h4>
        <a
          href={`/agents/${agentId}/edit?tab=runs`}
          className="text-xs text-slate-500 hover:text-slate-700 underline"
        >
          View all
        </a>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-4">No activity yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(event => (
            <li key={event.eventId} className="flex items-center gap-2">
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${eventTypeBadgeColor(event.eventType)}`}
              >
                {event.eventType}
              </span>
              <span className="text-xs text-slate-400 ml-auto shrink-0">
                {relativeTime(event.eventTimestamp)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
