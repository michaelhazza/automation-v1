interface Props {
  connections: unknown[];
  agentId: string;
}

export default function ConnectionsHealthCard({ connections }: Props) {
  return (
    <div className="bg-white rounded-lg border border-slate-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-slate-700">Connections</h4>
        <a
          href="/connections"
          className="text-xs text-slate-500 hover:text-slate-700 underline"
        >
          Manage connections
        </a>
      </div>
      {connections.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-4">
          No connections configured.{' '}
          <a href="/connections" className="underline hover:text-slate-600">
            Add one
          </a>
        </p>
      ) : (
        <p className="text-xs text-slate-500">{connections.length} {connections.length === 1 ? 'connection' : 'connections'} configured.</p>
      )}
    </div>
  );
}
