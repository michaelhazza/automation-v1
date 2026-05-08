interface QuickAction {
  label: string;
  description: string;
  href: string;
}

interface Props {
  agentId: string;
  identity: {
    id: string;
    name: string;
    role: string;
  };
}

export default function FirstRunOverview({ agentId, identity }: Props) {
  const quickActions: QuickAction[] = [
    {
      label: 'Configure this agent',
      description: 'Set instructions, model, and behaviour.',
      href: `/agents/${agentId}/edit?tab=configure`,
    },
    {
      label: 'Set a schedule',
      description: 'Run automatically on a trigger or timetable.',
      href: `/agents/${agentId}/edit?tab=schedule`,
    },
    {
      label: 'Add connections',
      description: 'Connect external services this agent can use.',
      href: '/connections',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-slate-100 p-4">
        <h3 className="text-base font-semibold text-slate-900 mb-0.5">
          Welcome to {identity.name}'s workspace
        </h3>
        {identity.role && (
          <p className="text-sm text-slate-500">{identity.role}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {quickActions.map(action => (
          <a
            key={action.href}
            href={action.href}
            className="bg-white rounded-lg border border-slate-100 p-4 hover:border-slate-300 hover:shadow-sm transition-all block"
          >
            <p className="text-sm font-semibold text-slate-700 mb-1">{action.label}</p>
            <p className="text-xs text-slate-500">{action.description}</p>
          </a>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-slate-100 p-4">
        <h4 className="text-sm font-semibold text-slate-700 mb-2">Identity</h4>
        <p className="text-sm text-slate-800 font-medium">{identity.name}</p>
        {identity.role && (
          <p className="text-xs text-slate-500 mt-0.5">{identity.role}</p>
        )}
      </div>

      <div className="bg-white rounded-lg border border-slate-100 p-4">
        <h4 className="text-sm font-semibold text-slate-700 mb-2">Tools</h4>
        <p className="text-xs text-slate-400 text-center py-2">
          Tool usage will appear here after the agent's first run.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-slate-100 p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-slate-700">Connections</h4>
          <a href="/connections" className="text-xs text-slate-500 hover:text-slate-700 underline">
            Manage
          </a>
        </div>
        <p className="text-xs text-slate-400 text-center py-2">
          No connections configured.
        </p>
      </div>
    </div>
  );
}
