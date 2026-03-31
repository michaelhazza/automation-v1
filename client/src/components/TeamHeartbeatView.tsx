const DEFAULT_ICONS = ['\u{1F50D}','\u{1F4CA}','\u{1F4DD}','\u{1F4E3}','\u{1F916}','\u{2699}\uFE0F','\u{1F4AC}','\u{1F4C8}','\u{2728}','\u{1F3AF}'];

function getDefaultIcon(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return DEFAULT_ICONS[Math.abs(hash) % DEFAULT_ICONS.length];
}

export interface HeartbeatAgent {
  id: string;
  name: string;
  icon?: string | null;
  heartbeatEnabled?: boolean;
  heartbeatIntervalHours?: number | null;
  heartbeatOffsetHours?: number;
}

export default function TeamHeartbeatView({ agents, compact = false }: { agents: HeartbeatAgent[]; compact?: boolean }) {
  const scheduled = agents.filter((a) => a.heartbeatEnabled && a.heartbeatIntervalHours);
  if (scheduled.length === 0) return null;
  const HOUR_LABELS = [0, 4, 8, 12, 16, 20, 24];

  return (
    <div className={compact ? '' : 'mt-8'}>
      <div className="mb-4">
        <h2 className={`font-extrabold text-slate-900 tracking-tight m-0 flex items-center gap-2 ${compact ? 'text-[16px]' : 'text-[18px]'}`}>
          <span>💓</span> Heartbeat Schedule
        </h2>
        <p className="text-[13px] text-slate-500 mt-1">When each agent wakes up and acts — across a 24h window</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
        <div className="flex items-center mb-3 pl-[180px]">
          {HOUR_LABELS.map((h) => (
            <div key={h} className="flex-1 text-[11px] text-slate-400 font-medium">{h}h</div>
          ))}
        </div>
        <div className="flex flex-col gap-3.5">
          {scheduled.map((agent) => {
            const interval = agent.heartbeatIntervalHours!;
            const offset = agent.heartbeatOffsetHours ?? 0;
            const runHours: number[] = [];
            for (let h = offset; h < 24; h += interval) runHours.push(h);
            const icon = agent.icon || getDefaultIcon(agent.id);
            return (
              <div key={agent.id} className="flex items-center">
                <div className="shrink-0 flex items-center gap-2 pr-4 w-[180px]">
                  <span className="text-base">{icon}</span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-slate-900 truncate">{agent.name}</div>
                    <div className="text-[11px] text-slate-400">every {interval}h</div>
                  </div>
                </div>
                <div className="flex-1 relative h-7">
                  <svg width="100%" height="28" className="block">
                    <line x1="0" y1="50%" x2="100%" y2="50%" stroke="#e2e8f0" strokeWidth="1.5" />
                    {HOUR_LABELS.map((h) => (
                      <line key={h} x1={`${(h / 24) * 100}%`} y1="30%" x2={`${(h / 24) * 100}%`} y2="70%" stroke="#e2e8f0" strokeWidth="1" />
                    ))}
                    {runHours.map((h) => (
                      <circle key={h} cx={`${(h / 24) * 100}%`} cy="50%" r="5" fill="#6366f1" />
                    ))}
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
