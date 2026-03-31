import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import TeamHeartbeatView from '../components/TeamHeartbeatView';

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

export default function AgentsPage({ user: _user }: { user: User }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/agents').then((res) => setAgents(res.data)).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="animate-[fadeIn_0.2s_ease-out_both] flex flex-col gap-4">
        <div className="h-9 w-72 rounded-lg bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
        <div className="h-5 w-80 rounded bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {[1,2,3,4,5,6].map((i) => <div key={i} className="h-48 rounded-2xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />)}
        </div>
      </div>
    );
  }

  const activeAgents = agents.filter((a) => a.status === 'active');
  const setupAgents = agents.filter((a) => a.status !== 'active');

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="mb-8">
        <h1 className="text-[30px] font-extrabold text-slate-900 tracking-tight m-0">Agents</h1>
        <p className="text-[15px] text-slate-500 mt-1.5">Select an agent to start a conversation</p>
      </div>

      {agents.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-14 px-8 flex flex-col items-center text-center">
          <div className="w-[72px] h-[72px] rounded-2xl flex items-center justify-center text-4xl mb-5 bg-[linear-gradient(135deg,#f5f3ff,#ede9fe)]">
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
            <div className={`grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))] ${setupAgents.length > 0 ? 'mb-10' : ''}`}>
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
                      <div className="w-[52px] h-[52px] rounded-xl flex items-center justify-center text-[26px] shrink-0 bg-[linear-gradient(135deg,#f5f3ff,#ede9fe)]">
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
              <div className="grid gap-4 opacity-60 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
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
