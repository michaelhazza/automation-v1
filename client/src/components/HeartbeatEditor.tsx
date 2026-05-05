import { useState, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

export interface HeartbeatAgentConfig {
  id: string;
  name: string;
  icon?: string | null;
  heartbeatEnabled: boolean;
  heartbeatIntervalHours: number | null;
  heartbeatOffsetHours: number;
  heartbeatOffsetMinutes: number;
}

interface Props {
  agents: HeartbeatAgentConfig[];
  onUpdate: (agentId: string, config: {
    heartbeatEnabled: boolean;
    heartbeatIntervalHours: number | null;
    heartbeatOffsetHours: number;
    heartbeatOffsetMinutes: number;
  }) => Promise<void>;
  timezone?: string;
  /** Label for context: "system agent", "agent", "company agent" */
  levelLabel?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const HOUR_LABELS = [0, 4, 8, 12, 16, 20, 24];
const INTERVALS = [1, 2, 3, 4, 6, 8, 12, 24];

function getRunMinutes(intervalHours: number, startHour: number, startMinute: number): number[] {
  const startTotal = startHour * 60 + startMinute;
  const intervalMins = intervalHours * 60;
  const mins: number[] = [];
  for (let m = startTotal; m < 24 * 60; m += intervalMins) mins.push(m);
  return mins;
}

function fmt(h: number, m: number) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function HeartbeatEditor({ agents, onUpdate, timezone = 'UTC', levelLabel = 'agent' }: Props) {
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleToggle = useCallback(async (agent: HeartbeatAgentConfig) => {
    const newEnabled = !agent.heartbeatEnabled;
    setSaving((s) => new Set(s).add(agent.id));
    try {
      await onUpdate(agent.id, {
        heartbeatEnabled: newEnabled,
        heartbeatIntervalHours: newEnabled ? (agent.heartbeatIntervalHours ?? 8) : agent.heartbeatIntervalHours,
        heartbeatOffsetHours: agent.heartbeatOffsetHours,
        heartbeatOffsetMinutes: agent.heartbeatOffsetMinutes,
      });
      if (newEnabled) setEditingId(agent.id);
    } finally {
      setSaving((s) => { const next = new Set(s); next.delete(agent.id); return next; });
    }
  }, [onUpdate]);

  const handleUpdate = useCallback(async (
    agent: HeartbeatAgentConfig,
    patch: Partial<{ heartbeatIntervalHours: number; heartbeatOffsetHours: number; heartbeatOffsetMinutes: number }>
  ) => {
    setSaving((s) => new Set(s).add(agent.id));
    try {
      await onUpdate(agent.id, {
        heartbeatEnabled: true,
        heartbeatIntervalHours: patch.heartbeatIntervalHours ?? agent.heartbeatIntervalHours,
        heartbeatOffsetHours: patch.heartbeatOffsetHours ?? agent.heartbeatOffsetHours,
        heartbeatOffsetMinutes: patch.heartbeatOffsetMinutes ?? agent.heartbeatOffsetMinutes,
      });
    } finally {
      setSaving((s) => { const next = new Set(s); next.delete(agent.id); return next; });
    }
  }, [onUpdate]);

  if (agents.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
        <p className="text-[14px] text-slate-500">No {levelLabel}s available.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-extrabold text-slate-900 tracking-tight m-0 flex items-center gap-2">
            <span>💓</span> Heartbeat Schedule
          </h2>
          <p className="text-[13px] text-slate-500 mt-1">
            Configure when each {levelLabel} wakes up and runs autonomously.
          </p>
        </div>
        <span className="text-[12px] text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full font-medium">
          🌍 {timezone}
        </span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Hour labels */}
        <div className="flex items-center px-6 pt-4 pb-1">
          <div style={{ width: 280 }} className="shrink-0" />
          {HOUR_LABELS.map((h) => (
            <div key={h} className="flex-1 text-[11px] text-slate-400 font-medium">{h}h</div>
          ))}
        </div>

        {/* Agent rows */}
        <div className="divide-y divide-slate-50">
          {agents.map((agent) => {
            const isSaving = saving.has(agent.id);
            const isEditing = editingId === agent.id;
            const interval = agent.heartbeatIntervalHours ?? 8;
            const runMins = agent.heartbeatEnabled ? getRunMinutes(interval, agent.heartbeatOffsetHours, agent.heartbeatOffsetMinutes) : [];

            return (
              <div key={agent.id} className={`px-6 py-3 ${isSaving ? 'opacity-60' : ''}`}>
                <div className="flex items-center">
                  {/* Agent label + toggle */}
                  <div className="shrink-0 flex items-center gap-2 pr-4" style={{ width: 280 }}>
                    <button
                      onClick={() => handleToggle(agent)}
                      disabled={isSaving}
                      className={`w-8 h-[18px] rounded-full relative transition-colors cursor-pointer border-0 shrink-0 ${agent.heartbeatEnabled ? 'bg-indigo-500' : 'bg-slate-300'}`}
                    >
                      <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${agent.heartbeatEnabled ? 'left-[16px]' : 'left-[2px]'}`} />
                    </button>
                    <span className="text-[14px] shrink-0">{agent.icon || '🤖'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-slate-900 truncate">{agent.name}</div>
                      {agent.heartbeatEnabled ? (
                        <button
                          onClick={() => setEditingId(isEditing ? null : agent.id)}
                          className="text-[11px] text-indigo-500 hover:text-indigo-600 bg-transparent border-0 cursor-pointer p-0 font-medium"
                        >
                          {fmt(agent.heartbeatOffsetHours, agent.heartbeatOffsetMinutes)} · every {interval}h {isEditing ? '▾' : '▸'}
                        </button>
                      ) : (
                        <div className="text-[11px] text-slate-400">disabled</div>
                      )}
                    </div>
                  </div>

                  {/* Timeline (read-only display) */}
                  <div className={`flex-1 relative h-7 ${!agent.heartbeatEnabled ? 'opacity-30' : ''}`}>
                    {/* overflow-visible so the dots at 0h/24h don't get
                        clipped at the SVG's left/right edges (cx=0%/100% with
                        r=5.5 would otherwise lose half the circle). */}
                    <svg width="100%" height="28" className="block overflow-visible">
                      <line x1="0" y1="50%" x2="100%" y2="50%" stroke="#e2e8f0" strokeWidth="1.5" />
                      {HOUR_LABELS.map((h) => (
                        <line key={h} x1={`${(h / 24) * 100}%`} y1="30%" x2={`${(h / 24) * 100}%`} y2="70%" stroke="#e2e8f0" strokeWidth="1" />
                      ))}
                      {runMins.map((m) => (
                        <circle key={m} cx={`${(m / (24 * 60)) * 100}%`} cy="50%" r="5.5" fill="#6366f1" className="transition-all" />
                      ))}
                    </svg>
                  </div>
                </div>

                {/* Expanded config */}
                {isEditing && agent.heartbeatEnabled && (
                  <div className="mt-3 ml-[280px] flex flex-wrap items-end gap-4 pb-1">
                    {/* Start time */}
                    <div>
                      <div className="text-[11px] text-slate-500 font-medium mb-1">Start time ({timezone})</div>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={agent.heartbeatOffsetHours}
                          onChange={(e) => handleUpdate(agent, { heartbeatOffsetHours: Number(e.target.value) })}
                          className="px-2 py-1.5 border border-slate-200 rounded-md text-[12px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          {Array.from({ length: 24 }, (_, i) => (
                            <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                          ))}
                        </select>
                        <span className="text-slate-400 text-[13px]">:</span>
                        <select
                          value={agent.heartbeatOffsetMinutes}
                          onChange={(e) => handleUpdate(agent, { heartbeatOffsetMinutes: Number(e.target.value) })}
                          className="px-2 py-1.5 border border-slate-200 rounded-md text-[12px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          {[0, 15, 30, 45].map((m) => (
                            <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Interval */}
                    <div>
                      <div className="text-[11px] text-slate-500 font-medium mb-1">Repeat every</div>
                      <div className="flex gap-1.5 flex-wrap">
                        {INTERVALS.map((iv) => (
                          <button
                            key={iv}
                            onClick={() => handleUpdate(agent, { heartbeatIntervalHours: iv })}
                            disabled={isSaving}
                            className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors border cursor-pointer ${
                              interval === iv
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            {iv === 24 ? '1 day' : `${iv}h`}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Summary */}
                    {runMins.length > 0 && (
                      <div className="text-[11px] text-slate-400 self-end pb-0.5">
                        Runs at: {runMins.map(m => fmt(Math.floor(m / 60), m % 60)).join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
