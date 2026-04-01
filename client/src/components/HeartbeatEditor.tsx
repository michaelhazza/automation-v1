import { useState, useRef, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

export interface HeartbeatAgentConfig {
  id: string;
  name: string;
  icon?: string | null;
  heartbeatEnabled: boolean;
  heartbeatIntervalHours: number | null;
  heartbeatOffsetHours: number;
}

interface Props {
  agents: HeartbeatAgentConfig[];
  onUpdate: (agentId: string, config: { heartbeatEnabled: boolean; heartbeatIntervalHours: number | null; heartbeatOffsetHours: number }) => Promise<void>;
  /** Label for context: "system agent", "agent", "company agent" */
  levelLabel?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const HOUR_LABELS = [0, 4, 8, 12, 16, 20, 24];
const INTERVALS = [2, 4, 6, 8, 12, 24];
const TIMELINE_LEFT = 200; // px reserved for agent label

function getRunHours(interval: number, offset: number): number[] {
  const hours: number[] = [];
  for (let h = offset; h < 24; h += interval) hours.push(h);
  return hours;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function HeartbeatEditor({ agents, onUpdate, levelLabel = 'agent' }: Props) {
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const handleToggle = useCallback(async (agent: HeartbeatAgentConfig) => {
    const newEnabled = !agent.heartbeatEnabled;
    setSaving((s) => new Set(s).add(agent.id));
    try {
      await onUpdate(agent.id, {
        heartbeatEnabled: newEnabled,
        heartbeatIntervalHours: newEnabled ? (agent.heartbeatIntervalHours ?? 8) : agent.heartbeatIntervalHours,
        heartbeatOffsetHours: agent.heartbeatOffsetHours,
      });
    } finally {
      setSaving((s) => { const next = new Set(s); next.delete(agent.id); return next; });
    }
  }, [onUpdate]);

  const handleIntervalChange = useCallback(async (agent: HeartbeatAgentConfig, interval: number) => {
    setSaving((s) => new Set(s).add(agent.id));
    try {
      await onUpdate(agent.id, {
        heartbeatEnabled: true,
        heartbeatIntervalHours: interval,
        heartbeatOffsetHours: agent.heartbeatOffsetHours % interval, // clamp offset within interval
      });
    } finally {
      setSaving((s) => { const next = new Set(s); next.delete(agent.id); return next; });
    }
  }, [onUpdate]);

  const handleTimelineDrag = useCallback((agent: HeartbeatAgentConfig, e: React.MouseEvent) => {
    if (!timelineRef.current || !agent.heartbeatIntervalHours) return;
    const rect = timelineRef.current.getBoundingClientRect();
    // Find the timeline area (same row) - approximate from click position
    const row = (e.target as HTMLElement).closest('[data-timeline-row]');
    if (!row) return;
    const rowRect = row.getBoundingClientRect();
    const relX = e.clientX - rowRect.left;
    const pct = Math.max(0, Math.min(1, relX / rowRect.width));
    const hour = Math.round(pct * 24);
    const newOffset = Math.max(0, Math.min(23, hour)) % (agent.heartbeatIntervalHours ?? 8);

    setSaving((s) => new Set(s).add(agent.id));
    onUpdate(agent.id, {
      heartbeatEnabled: true,
      heartbeatIntervalHours: agent.heartbeatIntervalHours,
      heartbeatOffsetHours: newOffset,
    }).finally(() => {
      setSaving((s) => { const next = new Set(s); next.delete(agent.id); return next; });
    });
  }, [onUpdate]);

  if (agents.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
        <p className="text-[14px] text-slate-500">No {levelLabel}s available. Add {levelLabel}s to configure heartbeat schedules.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-[16px] font-extrabold text-slate-900 tracking-tight m-0 flex items-center gap-2">
          <span>💓</span> Heartbeat Schedule
        </h2>
        <p className="text-[13px] text-slate-500 mt-1">
          Configure when each {levelLabel} wakes up. Click the timeline to adjust start time. Toggle to enable/disable.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl px-6 py-5" ref={timelineRef}>
        {/* Hour labels */}
        <div className="flex items-center mb-3" style={{ paddingLeft: TIMELINE_LEFT }}>
          {HOUR_LABELS.map((h) => (
            <div key={h} className="flex-1 text-[11px] text-slate-400 font-medium">{h}h</div>
          ))}
        </div>

        {/* Agent rows */}
        <div className="flex flex-col gap-4">
          {agents.map((agent) => {
            const isSaving = saving.has(agent.id);
            const isEditing = editingId === agent.id;
            const interval = agent.heartbeatIntervalHours ?? 8;
            const runHours = agent.heartbeatEnabled ? getRunHours(interval, agent.heartbeatOffsetHours) : [];

            return (
              <div key={agent.id} className={`${isSaving ? 'opacity-60' : ''}`}>
                <div className="flex items-center">
                  {/* Agent label + controls */}
                  <div className="shrink-0 flex items-center gap-2 pr-4" style={{ width: TIMELINE_LEFT }}>
                    {/* Toggle */}
                    <button
                      onClick={() => handleToggle(agent)}
                      disabled={isSaving}
                      className={`w-8 h-[18px] rounded-full relative transition-colors cursor-pointer border-0 ${agent.heartbeatEnabled ? 'bg-indigo-500' : 'bg-slate-300'}`}
                    >
                      <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${agent.heartbeatEnabled ? 'left-[16px]' : 'left-[2px]'}`} />
                    </button>
                    <span className="text-[14px] shrink-0">{agent.icon || '🤖'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-slate-900 truncate">{agent.name}</div>
                      {agent.heartbeatEnabled && (
                        <button
                          onClick={() => setEditingId(isEditing ? null : agent.id)}
                          className="text-[11px] text-indigo-500 hover:text-indigo-600 bg-transparent border-0 cursor-pointer p-0 font-medium"
                        >
                          every {interval}h {isEditing ? '▾' : '▸'}
                        </button>
                      )}
                      {!agent.heartbeatEnabled && (
                        <div className="text-[11px] text-slate-400">disabled</div>
                      )}
                    </div>
                  </div>

                  {/* Timeline */}
                  <div
                    className={`flex-1 relative h-7 ${agent.heartbeatEnabled ? 'cursor-pointer' : 'opacity-30'}`}
                    data-timeline-row
                    onClick={agent.heartbeatEnabled ? (e) => handleTimelineDrag(agent, e) : undefined}
                  >
                    <svg width="100%" height="28" className="block">
                      <line x1="0" y1="50%" x2="100%" y2="50%" stroke="#e2e8f0" strokeWidth="1.5" />
                      {HOUR_LABELS.map((h) => (
                        <line key={h} x1={`${(h / 24) * 100}%`} y1="30%" x2={`${(h / 24) * 100}%`} y2="70%" stroke="#e2e8f0" strokeWidth="1" />
                      ))}
                      {runHours.map((h) => (
                        <circle key={h} cx={`${(h / 24) * 100}%`} cy="50%" r="5.5" fill={agent.heartbeatEnabled ? '#6366f1' : '#cbd5e1'} className="transition-all" />
                      ))}
                    </svg>
                  </div>
                </div>

                {/* Interval selector (expanded) */}
                {isEditing && agent.heartbeatEnabled && (
                  <div className="mt-2 flex items-center gap-2" style={{ marginLeft: TIMELINE_LEFT }}>
                    <span className="text-[11px] text-slate-500 font-medium">Interval:</span>
                    {INTERVALS.map((iv) => (
                      <button
                        key={iv}
                        onClick={() => handleIntervalChange(agent, iv)}
                        disabled={isSaving}
                        className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors border cursor-pointer ${
                          interval === iv
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {iv}h
                      </button>
                    ))}
                    <span className="text-[11px] text-slate-400 ml-2">
                      Starts at {agent.heartbeatOffsetHours}:00 UTC — click timeline to change
                    </span>
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
