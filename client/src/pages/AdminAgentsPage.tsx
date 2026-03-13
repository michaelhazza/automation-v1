import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import ConfirmDialog from '../components/ConfirmDialog';

interface Agent {
  id: string;
  name: string;
  description: string | null;
  status: string;
  modelId: string;
  dataSources?: { id: string }[];
  dataSourceCount?: number;
  createdAt: string;
}

const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  active:   { bg: '#dcfce7', color: '#166534' },
  inactive: { bg: '#fff7ed', color: '#9a3412' },
  draft:    { bg: '#f1f5f9', color: '#475569' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? STATUS_BADGE.draft;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 600,
      background: s.bg,
      color: s.color,
      textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

export default function AdminAgentsPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/agents');
      setAgents(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleActivate = async (id: string) => {
    setActionError((prev) => ({ ...prev, [id]: '' }));
    try {
      await api.post(`/api/agents/${id}/activate`);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError((prev) => ({ ...prev, [id]: e.response?.data?.error ?? 'Failed to activate' }));
    }
  };

  const handleDeactivate = async (id: string) => {
    setActionError((prev) => ({ ...prev, [id]: '' }));
    try {
      await api.post(`/api/agents/${id}/deactivate`);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError((prev) => ({ ...prev, [id]: e.response?.data?.error ?? 'Failed to deactivate' }));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/agents/${deleteId}`);
      setDeleteId(null);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError((prev) => ({ ...prev, [deleteId]: e.response?.data?.error ?? 'Failed to delete' }));
      setDeleteId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
        Loading agents...
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>Agents</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>Create and manage AI agent configurations</p>
        </div>
        <button
          onClick={() => navigate('/admin/agents/new')}
          style={{ padding: '10px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}
        >
          + New Agent
        </button>
      </div>

      {deleteId && (
        <ConfirmDialog
          title="Delete agent"
          message="Are you sure you want to delete this agent? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {agents.length === 0 ? (
          <div style={{ padding: '64px 48px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🤖</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>No agents yet</div>
            <div style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>Create your first AI agent to get started.</div>
            <button
              onClick={() => navigate('/admin/agents/new')}
              style={{ padding: '10px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}
            >
              + New Agent
            </button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 13 }}>Name</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 13 }}>Status</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 13 }}>Model</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 13 }}>Data Sources</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 13 }}>Created</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 13 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const dsCount = agent.dataSourceCount ?? agent.dataSources?.length ?? 0;
                return (
                  <tr key={agent.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600, color: '#1e293b' }}>{agent.name}</div>
                      {agent.description && (
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {agent.description}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <StatusBadge status={agent.status} />
                    </td>
                    <td style={{ padding: '12px 16px', color: '#475569', fontSize: 13 }}>
                      {agent.modelId ?? '—'}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#475569', fontSize: 13 }}>
                      {dsCount} {dsCount === 1 ? 'source' : 'sources'}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#64748b', fontSize: 13 }}>
                      {new Date(agent.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Link
                          to={`/admin/agents/${agent.id}`}
                          style={{ padding: '4px 10px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', textDecoration: 'none', fontWeight: 500 }}
                        >
                          Edit
                        </Link>
                        {agent.status !== 'active' && (
                          <button
                            onClick={() => handleActivate(agent.id)}
                            style={{ padding: '4px 10px', background: '#dcfce7', color: '#166534', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                          >
                            Activate
                          </button>
                        )}
                        {agent.status === 'active' && (
                          <button
                            onClick={() => handleDeactivate(agent.id)}
                            style={{ padding: '4px 10px', background: '#fff7ed', color: '#9a3412', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                          >
                            Deactivate
                          </button>
                        )}
                        <button
                          onClick={() => setDeleteId(agent.id)}
                          style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                        >
                          Delete
                        </button>
                      </div>
                      {actionError[agent.id] && (
                        <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>{actionError[agent.id]}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
