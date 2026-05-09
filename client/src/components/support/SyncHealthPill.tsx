interface Props {
  health: 'running' | 'degraded' | 'failed';
  lastSyncAt?: Date | string | null;
  tooltip?: string | null;
}

function relativeTime(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function SyncHealthPill({ health, lastSyncAt, tooltip }: Props) {
  if (health === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
        {lastSyncAt ? `Last sync · ${relativeTime(lastSyncAt)}` : 'Running'}
      </span>
    );
  }

  if (health === 'degraded') {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs text-amber-600 cursor-help"
        title={tooltip ?? 'Provider sync is degraded'}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
        Degraded
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-red-600 cursor-help"
      title={tooltip ?? 'Connection failed'}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
      Connection failed
    </span>
  );
}
