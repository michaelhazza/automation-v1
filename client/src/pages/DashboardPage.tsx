import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Agent {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  status: string;
}

interface Execution {
  id: string;
  processId: string;
  status: string;
  createdAt: string;
  durationMs: number | null;
  isTestExecution: boolean;
}

const DEFAULT_ICONS = [
  '\u{1F50D}', '\u{1F4CA}', '\u{1F4DD}', '\u{1F4E3}', '\u{1F916}',
  '\u{2699}\uFE0F', '\u{1F4AC}', '\u{1F4C8}', '\u{2728}', '\u{1F3AF}',
];

function getDefaultIcon(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return DEFAULT_ICONS[Math.abs(hash) % DEFAULT_ICONS.length];
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="badge-dot" />
      {status}
    </span>
  );
}

export default function DashboardPage({ user }: { user: User }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      try {
        const [agentRes, execRes] = await Promise.all([
          api.get('/api/agents'),
          api.get('/api/executions', { params: { limit: 5 } }),
        ]);
        setAgents(agentRes.data);
        setExecutions(execRes.data);
      } catch {
        // silently handle
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const activeAgents = agents.filter(a => a.status === 'active');

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="skeleton" style={{ height: 36, width: 280, marginBottom: 8 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton" style={{ height: 100, borderRadius: 14 }} />
          ))}
        </div>
        <div className="skeleton" style={{ height: 200, borderRadius: 14 }} />
      </div>
    );
  }

  return (
    <div className="page-enter">
      {/* Greeting */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.03em' }}>
          {greeting}, {user.firstName}
        </h1>
        <p style={{ color: '#64748b', marginTop: 6, fontSize: 14 }}>
          {activeAgents.length > 0
            ? `You have ${activeAgents.length} AI team member${activeAgents.length === 1 ? '' : 's'} ready to help.`
            : "Let's get your AI team set up."
          }
        </p>
      </div>

      {/* Quick access: Active agents */}
      {activeAgents.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
              Quick Chat
            </h2>
            <Link to="/agents" style={{ fontSize: 13, color: '#6366f1', textDecoration: 'none', fontWeight: 600 }}>
              View all agents
            </Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {activeAgents.slice(0, 6).map((agent) => {
              const icon = agent.icon || getDefaultIcon(agent.id);
              return (
                <div
                  key={agent.id}
                  onClick={() => navigate(`/agents/${agent.id}`)}
                  style={{
                    background: '#fff',
                    border: '1.5px solid #e8ecf7',
                    borderRadius: 14,
                    padding: '16px 18px',
                    cursor: 'pointer',
                    transition: 'box-shadow 0.15s, border-color 0.15s, transform 0.1s',
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(99,102,241,0.1)';
                    (e.currentTarget as HTMLDivElement).style.borderColor = '#a5b4fc';
                    (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.boxShadow = '';
                    (e.currentTarget as HTMLDivElement).style.borderColor = '#e8ecf7';
                    (e.currentTarget as HTMLDivElement).style.transform = '';
                  }}
                >
                  <div style={{
                    width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                    background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                  }}>
                    {icon}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {agent.name}
                    </div>
                    {agent.description && (
                      <div style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {agent.description}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state for new users */}
      {agents.length === 0 && (
        <div className="card empty-state" style={{ padding: '48px 32px', marginBottom: 32 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 18, marginBottom: 16,
            background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
          }}>
            {'\u{1F916}'}
          </div>
          <p style={{ margin: '0 0 8px', fontWeight: 700, fontSize: 17, color: '#0f172a' }}>
            Welcome to Automation OS
          </p>
          <p style={{ margin: '0 0 20px', fontSize: 14, color: '#64748b', maxWidth: 380, textAlign: 'center', lineHeight: 1.6 }}>
            Your AI team will appear here once they are set up.
            Ask your administrator to create agents and assign them to your account.
          </p>
        </div>
      )}

      {/* Recent activity */}
      {executions.length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
              Recent Activity
            </h2>
            <Link to="/executions" style={{ fontSize: 13, color: '#6366f1', textDecoration: 'none', fontWeight: 600 }}>
              View all
            </Link>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((exec) => (
                  <tr key={exec.id}>
                    <td>
                      <Link
                        to={`/executions/${exec.id}`}
                        style={{ color: '#6366f1', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
                      >
                        {exec.id.substring(0, 8)}
                      </Link>
                    </td>
                    <td><StatusBadge status={exec.status} /></td>
                    <td style={{ color: '#64748b', fontSize: 13 }}>
                      {exec.durationMs != null ? `${(exec.durationMs / 1000).toFixed(1)}s` : '\u2014'}
                    </td>
                    <td style={{ color: '#64748b', fontSize: 13 }}>
                      {new Date(exec.createdAt).toLocaleString(undefined, {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
