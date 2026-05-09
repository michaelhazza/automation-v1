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
  // Identity-language quick actions per locked brief — the first-run surface
  // sells the embodiment layer, so we frame these as agent identity moves
  // ("teach", "decide when it should work", "watch") rather than config tasks
  // ("configure", "set a schedule", "add connections").
  const quickActions: QuickAction[] = [
    {
      label: 'Teach the agent',
      description: 'Give it instructions, knowledge, and a way of working.',
      href: `/agents/${agentId}/edit?tab=behaviour`,
    },
    {
      label: 'Decide when it should work',
      description: 'Pick the triggers and timetable for when this agent runs.',
      href: `/agents/${agentId}/edit?tab=schedule`,
    },
    {
      label: 'Watch it work',
      description: 'See live progress, observations, and connections as runs happen.',
      href: `/agents/${agentId}/edit?tab=runs`,
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
