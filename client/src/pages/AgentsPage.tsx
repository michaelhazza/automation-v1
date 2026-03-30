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

// Default icons for agents that don't have a custom one set
const DEFAULT_ICONS = [
  '\u{1F50D}', '\u{1F4CA}', '\u{1F4DD}', '\u{1F4E3}', '\u{1F916}',
  '\u{2699}\uFE0F', '\u{1F4AC}', '\u{1F4C8}', '\u{2728}', '\u{1F3AF}',
];

function getDefaultIcon(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  return DEFAULT_ICONS[Math.abs(hash) % DEFAULT_ICONS.length];
}

function getSkillSummary(skillSlugs?: string[]): string {
  if (!skillSlugs || skillSlugs.length === 0) return '';
  const labels: Record<string, string> = {
    web_search: 'Web search',
    read_workspace: 'Read tasks',
    write_workspace: 'Update tasks',
    create_task: 'Create tasks',
    move_task: 'Manage workflow',
    trigger_process: 'Run automations',
    add_deliverable: 'Create deliverables',
  };
  const named = skillSlugs.map(s => labels[s] || s.replace(/_/g, ' ')).slice(0, 3);
  const extra = skillSlugs.length > 3 ? ` +${skillSlugs.length - 3} more` : '';
  return named.join(', ') + extra;
}

// ── Heartbeat schedule timeline ──────────────────────────────────────────────
function TeamHeartbeatView({ agents }: { agents: Agent[] }) {
  const scheduled = agents.filter(a => a.heartbeatEnabled && a.heartbeatIntervalHours);
  if (scheduled.length === 0) return null;

  const HOUR_LABELS = [0, 4, 8, 12, 16, 20, 24];

  return (
    <div style={{ marginTop: 48 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: '0 0 4px', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>💓</span> Heartbeat Schedule
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>When each agent wakes up and acts — across a 24h window</p>
      </div>

      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '20px 24px' }}>
        {/* Hour axis header */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, paddingLeft: 180 }}>
          {HOUR_LABELS.map((h) => (
            <div key={h} style={{ flex: 1, fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{h}h</div>
          ))}
        </div>

        {/* Agent rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {scheduled.map((agent) => {
            const interval = agent.heartbeatIntervalHours!;
            const offset = agent.heartbeatOffsetHours ?? 0;
            const runHours: number[] = [];
            for (let h = offset; h < 24; h += interval) runHours.push(h);
            const icon = agent.icon || getDefaultIcon(agent.id);

            return (
              <div key={agent.id} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                {/* Agent label */}
                <div style={{ width: 180, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, paddingRight: 16 }}>
                  <span style={{ fontSize: 16 }}>{icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {agent.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>every {interval}h</div>
                  </div>
                </div>
                {/* SVG row */}
                <div style={{ flex: 1, position: 'relative', height: 28 }}>
                  <svg width="100%" height="28" style={{ display: 'block' }}>
                    <line x1="0" y1="50%" x2="100%" y2="50%" stroke="#e2e8f0" strokeWidth="1.5" />
                    {HOUR_LABELS.map((h) => (
                      <line key={h} x1={`${h / 24 * 100}%`} y1="30%" x2={`${h / 24 * 100}%`} y2="70%" stroke="#e2e8f0" strokeWidth="1" />
                    ))}
                    {runHours.map((h) => (
                      <circle key={h} cx={`${h / 24 * 100}%`} cy="50%" r="5" fill="#6366f1" />
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

export default function AgentsPage({ user }: { user: User }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/agents')
      .then((res) => setAgents(res.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="page-enter">
        <div className="skeleton" style={{ height: 36, width: 280, marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 20, width: 360, marginBottom: 28 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="skeleton" style={{ height: 200, borderRadius: 16 }} />
          ))}
        </div>
      </div>
    );
  }

  const activeAgents = agents.filter(a => a.status === 'active');
  const setupAgents = agents.filter(a => a.status !== 'active');

  return (
    <div className="page-enter">
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 30, fontWeight: 800, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.03em' }}>
          Agents
        </h1>
        <p style={{ color: '#64748b', margin: 0, fontSize: 15 }}>
          Select an agent to start a conversation
        </p>
      </div>

      {/* Empty state */}
      {agents.length === 0 ? (
        <div className="card empty-state" style={{ padding: '56px 32px' }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20, marginBottom: 20,
            background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32,
          }}>
            {'\u{1F916}'}
          </div>
          <p style={{ margin: '0 0 8px', fontWeight: 700, fontSize: 18, color: '#0f172a' }}>
            No team members yet
          </p>
          <p style={{ margin: 0, fontSize: 14, color: '#64748b', maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>
            Your AI team will appear here once your administrator sets them up.
            Each agent is trained on your data and ready to help.
          </p>
        </div>
      ) : (
        <>
          {/* Active agents */}
          {activeAgents.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, marginBottom: setupAgents.length > 0 ? 40 : 0 }}>
              {activeAgents.map((agent) => {
                const icon = agent.icon || getDefaultIcon(agent.id);
                const skillSummary = getSkillSummary(agent.defaultSkillSlugs);
                return (
                  <div
                    key={agent.id}
                    onClick={() => navigate(`/agents/${agent.id}`)}
                    style={{
                      background: '#fff',
                      border: '2px solid #e8ecf7',
                      borderRadius: 16,
                      padding: '24px 24px 20px',
                      cursor: 'pointer',
                      transition: 'box-shadow 0.18s, border-color 0.18s, transform 0.12s',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 14,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 30px rgba(99,102,241,0.12)';
                      (e.currentTarget as HTMLDivElement).style.borderColor = '#a5b4fc';
                      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-3px)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.boxShadow = '';
                      (e.currentTarget as HTMLDivElement).style.borderColor = '#e8ecf7';
                      (e.currentTarget as HTMLDivElement).style.transform = '';
                    }}
                  >
                    {/* Icon + Status */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <div style={{
                        width: 52, height: 52, borderRadius: 14, flexShrink: 0,
                        background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 26,
                      }}>
                        {icon}
                      </div>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '4px 10px', borderRadius: 9999,
                        background: '#f0fdf4', border: '1px solid #bbf7d0',
                        fontSize: 11, fontWeight: 600, color: '#15803d',
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                        Ready
                      </span>
                    </div>

                    {/* Name + Description */}
                    <div>
                      <div style={{ fontWeight: 800, color: '#0f172a', fontSize: 18, letterSpacing: '-0.02em', lineHeight: 1.25, marginBottom: 6 }}>
                        {agent.name}
                      </div>
                      {agent.description && (
                        <div style={{
                          fontSize: 13.5, color: '#64748b', lineHeight: 1.55,
                          overflow: 'hidden', display: '-webkit-box',
                          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        }}>
                          {agent.description}
                        </div>
                      )}
                    </div>

                    {/* Capabilities line */}
                    {skillSummary && (
                      <div style={{
                        fontSize: 11.5, color: '#94a3b8', fontWeight: 500,
                        padding: '6px 10px', background: '#f8fafc', borderRadius: 8,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {skillSummary}
                      </div>
                    )}

                    {/* CTA */}
                    <div style={{ marginTop: 'auto', paddingTop: 4 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/agents/${agent.id}`); }}
                        className="btn btn-primary"
                        style={{ width: '100%', justifyContent: 'center', fontSize: 14, padding: '10px 16px' }}
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

          {/* Setup-needed agents (like ExpertOS locked state) */}
          {setupAgents.length > 0 && (
            <>
              <div style={{ marginBottom: 14 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: '#64748b', margin: 0 }}>
                  Setting Up ({setupAgents.length})
                </h2>
                <p style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 0' }}>
                  These agents are being configured and will be available soon.
                </p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, opacity: 0.6 }}>
                {setupAgents.map((agent) => {
                  const icon = agent.icon || getDefaultIcon(agent.id);
                  return (
                    <div
                      key={agent.id}
                      style={{
                        background: '#fff',
                        border: '1.5px dashed #d1d5db',
                        borderRadius: 16,
                        padding: '24px',
                        display: 'flex', flexDirection: 'column', gap: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                          background: '#f1f5f9',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 22, filter: 'grayscale(0.5)',
                        }}>
                          {icon}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, color: '#475569', fontSize: 15 }}>{agent.name}</div>
                          <div style={{ fontSize: 12, color: '#94a3b8' }}>Needs setup to get started</div>
                        </div>
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
