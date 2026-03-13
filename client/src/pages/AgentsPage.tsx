import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Agent {
  id: string;
  name: string;
  description?: string;
  modelId: string;
  status: string;
}

function modelLabel(modelId: string): string {
  if (modelId.includes('opus')) return 'Claude Opus';
  if (modelId.includes('sonnet')) return 'Claude Sonnet';
  if (modelId.includes('haiku')) return 'Claude Haiku';
  if (modelId.includes('gpt-4')) return 'GPT-4';
  if (modelId.includes('gpt-3')) return 'GPT-3.5';
  return modelId;
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
        <div className="skeleton" style={{ height: 36, width: 220, marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 20, width: 360, marginBottom: 28 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="skeleton" style={{ height: 160, borderRadius: 14 }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page-enter">
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.03em' }}>
          Agents
        </h1>
        <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>
          Chat with AI employees trained on your data
        </p>
      </div>

      {/* Empty state */}
      {agents.length === 0 ? (
        <div className="card empty-state">
          <div style={{
            width: 56, height: 56, borderRadius: 16, marginBottom: 16,
            background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
              <path d="M12 8v4" />
              <rect x="4" y="12" width="16" height="9" rx="2" />
              <path d="M8 12v-1a4 4 0 0 1 8 0v1" />
            </svg>
          </div>
          <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 16, color: '#0f172a' }}>
            No AI employees available yet
          </p>
          <p style={{ margin: 0, fontSize: 13.5, color: '#64748b', maxWidth: 360, textAlign: 'center' }}>
            No AI employees are available yet. Ask your administrator to set one up.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {agents.map((agent) => (
            <div
              key={agent.id}
              onClick={() => navigate(`/agents/${agent.id}`)}
              style={{
                background: '#fff',
                border: '1px solid #e8ecf7',
                borderRadius: 14,
                padding: '22px 24px',
                cursor: 'pointer',
                transition: 'box-shadow 0.15s, border-color 0.15s, transform 0.1s',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 20px rgba(99,102,241,0.13)';
                (e.currentTarget as HTMLDivElement).style.borderColor = '#a5b4fc';
                (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.boxShadow = '';
                (e.currentTarget as HTMLDivElement).style.borderColor = '#e8ecf7';
                (e.currentTarget as HTMLDivElement).style.transform = '';
              }}
            >
              {/* Top row: avatar + status */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                  </svg>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                  {/* Status */}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 9px', borderRadius: 9999,
                    background: agent.status === 'active' ? '#f0fdf4' : '#f8fafc',
                    border: `1px solid ${agent.status === 'active' ? '#bbf7d0' : '#e2e8f0'}`,
                    fontSize: 11, fontWeight: 600,
                    color: agent.status === 'active' ? '#15803d' : '#64748b',
                  }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: agent.status === 'active' ? '#22c55e' : '#94a3b8',
                      flexShrink: 0,
                    }} />
                    {agent.status === 'active' ? 'Active' : agent.status}
                  </span>
                  {/* Model badge */}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '2px 8px', borderRadius: 9999,
                    background: '#f5f3ff',
                    border: '1px solid #c7d2fe',
                    fontSize: 10.5, fontWeight: 600, color: '#6366f1',
                    whiteSpace: 'nowrap',
                  }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                    {modelLabel(agent.modelId)}
                  </span>
                </div>
              </div>

              {/* Agent name */}
              <div>
                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: 17, letterSpacing: '-0.02em', lineHeight: 1.25, marginBottom: 6 }}>
                  {agent.name}
                </div>
                {agent.description && (
                  <div style={{
                    fontSize: 13, color: '#64748b', lineHeight: 1.55,
                    overflow: 'hidden', display: '-webkit-box',
                    WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                  }}>
                    {agent.description}
                  </div>
                )}
              </div>

              {/* Start Chat button */}
              <div style={{ marginTop: 'auto', paddingTop: 4 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(`/agents/${agent.id}`); }}
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', fontSize: 13.5, padding: '9px 16px' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  Start Chat
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
