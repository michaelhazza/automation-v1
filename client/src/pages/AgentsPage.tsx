import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Agent {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  modelId: string;
  status: string;
  defaultSkillSlugs?: string[];
  heartbeatEnabled?: boolean;
  heartbeatIntervalHours?: number | null;
  heartbeatOffsetHours?: number;
}

const DEFAULT_ICONS = ['\u{1F50D}','\u{1F4CA}','\u{1F4DD}','\u{1F4E3}','\u{1F916}','\u{2699}\uFE0F','\u{1F4AC}','\u{1F4C8}','\u{2728}','\u{1F3AF}'];

function getDefaultIcon(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  return DEFAULT_ICONS[Math.abs(hash) % DEFAULT_ICONS.length];
}

function getSkillSummary(skillSlugs?: string[]): string {
  if (!skillSlugs || skillSlugs.length === 0) return '';
  const labels: Record<string, string> = {
    web_search: 'Web search', read_workspace: 'Read tasks', write_workspace: 'Update tasks',
    create_task: 'Create tasks', move_task: 'Manage workflow', trigger_process: 'Run automations',
    add_deliverable: 'Create deliverables',
  };
  const named = skillSlugs.map((s) => labels[s] || s.replace(/_/g, ' ')).slice(0, 3);
  const extra = skillSlugs.length > 3 ? ` +${skillSlugs.length - 3} more` : '';
  return named.join(', ') + extra;
}

function TeamHeartbeatView({ agents }: { agents: Agent[] }) {
  const scheduled = agents.filter((a) => a.heartbeatEnabled && a.heartbeatIntervalHours);
  if (scheduled.length === 0) return null;
  const HOUR_LABELS = [0, 4, 8, 12, 16, 20, 24];

  return (
    <div className="mt-12">
      <div className="mb-4">
        <h2 className="text-[18px] font-extrabold text-slate-900 tracking-tight m-0 flex items-center gap-2">
          <span>💓</span> Heartbeat Schedule
        </h2>
        <p className="text-[13px] text-slate-500 mt-1">When each agent wakes up and acts — across a 24h window</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
        <div className="flex items-center mb-3" style={{ paddingLeft: 180 }}>
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
                <div className="shrink-0 flex items-center gap-2 pr-4" style={{ width: 180 }}>
                  <span className="text-base">{icon}</span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-slate-900 truncate">{agent.name}</div>
                    <div className="text-[11px] text-slate-400">every {interval}h</div>
                  </div>
                </div>
                <div className="flex-1 relative h-7">
                  <svg width="100%" height="28" style={{ display: 'block' }}>
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

export default function AgentsPage({ user: _user }: { user: User }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/agents').then((res) => setAgents(res.data)).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="page-enter flex flex-col gap-4">
        <div className="skeleton h-9 w-72 rounded-lg" />
        <div className="skeleton h-5 w-80 rounded" />
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {[1,2,3,4,5,6].map((i) => <div key={i} className="skeleton h-48 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  const activeAgents = agents.filter((a) => a.status === 'active');
  const setupAgents = agents.filter((a) => a.status !== 'active');

  return (
    <div className="page-enter">
      <div className="mb-8">
        <h1 className="text-[30px] font-extrabold text-slate-900 tracking-tight m-0">Agents</h1>
        <p className="text-[15px] text-slate-500 mt-1.5">Select an agent to start a conversation</p>
      </div>

      {agents.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-14 px-8 flex flex-col items-center text-center">
          <div className="w-18 h-18 rounded-2xl flex items-center justify-center text-4xl mb-5" style={{ background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)', width: 72, height: 72 }}>
            🤖
          </div>
          <p className="font-bold text-[18px] text-slate-900 mb-2">No team members yet</p>
          <p className="text-sm text-slate-500 max-w-[400px] leading-relaxed">
            Your AI team will appear here once your administrator sets them up.
            Each agent is trained on your data and ready to help.
          </p>
        </div>
      ) : (
        <>
          {activeAgents.length > 0 && (
            <div className={`grid gap-4 ${setupAgents.length > 0 ? 'mb-10' : ''}`} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {activeAgents.map((agent) => {
                const icon = agent.icon || getDefaultIcon(agent.id);
                const skillSummary = getSkillSummary(agent.defaultSkillSlugs);
                return (
                  <div
                    key={agent.id}
                    onClick={() => navigate(`/agents/${agent.id}`)}
                    className="bg-white border-2 border-slate-100 rounded-2xl p-6 cursor-pointer flex flex-col gap-3.5 hover:border-indigo-300 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-150"
                  >
                    <div className="flex items-start justify-between">
                      <div className="w-13 h-13 rounded-xl flex items-center justify-center text-[26px] shrink-0" style={{ width: 52, height: 52, background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)' }}>
                        {icon}
                      </div>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-green-50 border border-green-200 text-green-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        Ready
                      </span>
                    </div>

                    <div>
                      <div className="font-extrabold text-slate-900 text-[18px] tracking-tight leading-snug mb-1.5">{agent.name}</div>
                      {agent.description && (
                        <div className="text-[13.5px] text-slate-500 leading-relaxed line-clamp-2">{agent.description}</div>
                      )}
                    </div>

                    {skillSummary && (
                      <div className="text-[11.5px] text-slate-400 font-medium px-2.5 py-1.5 bg-slate-50 rounded-lg truncate">
                        {skillSummary}
                      </div>
                    )}

                    <div className="mt-auto pt-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/agents/${agent.id}`); }}
                        className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                        Start Chat
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {setupAgents.length > 0 && (
            <>
              <div className="mb-3.5">
                <h2 className="text-[16px] font-bold text-slate-500 m-0">Setting Up ({setupAgents.length})</h2>
                <p className="text-[13px] text-slate-400 mt-1">These agents are being configured and will be available soon.</p>
              </div>
              <div className="grid gap-4 opacity-60" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                {setupAgents.map((agent) => {
                  const icon = agent.icon || getDefaultIcon(agent.id);
                  return (
                    <div key={agent.id} className="bg-white border-2 border-dashed border-slate-300 rounded-2xl p-6 flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-[22px] shrink-0 grayscale-[50%]">{icon}</div>
                      <div>
                        <div className="font-bold text-slate-600 text-[15px]">{agent.name}</div>
                        <div className="text-xs text-slate-400">Needs setup to get started</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      <TeamHeartbeatView agents={agents} />
    </div>
  );
}
