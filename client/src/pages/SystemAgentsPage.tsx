import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import ConfirmDialog from '../components/ConfirmDialog';

interface SystemAgent {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  isPublished: boolean;
  defaultSystemSkillSlugs: string[] | null;
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
      fontWeight: 500,
      background: s.bg,
      color: s.color,
      textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

function PublishedBadge({ published }: { published: boolean }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 500,
      background: published ? '#dcfce7' : '#f1f5f9',
      color: published ? '#166534' : '#475569',
    }}>
      {published ? 'Yes' : 'No'}
    </span>
  );
}

export default function SystemAgentsPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<SystemAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/system/agents');
      setAgents(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handlePublish = async (id: string) => {
    setActionError((prev) => ({ ...prev, [id]: '' }));
    try {
      await api.post(`/api/system/agents/${id}/publish`);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError((prev) => ({ ...prev, [id]: e.response?.data?.error ?? 'Failed to publish' }));
    }
  };

  const handleUnpublish = async (id: string) => {
    setActionError((prev) => ({ ...prev, [id]: '' }));
    try {
      await api.post(`/api/system/agents/${id}/unpublish`);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError((prev) => ({ ...prev, [id]: e.response?.data?.error ?? 'Failed to unpublish' }));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/system/agents/${deleteId}`);
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
        Loading system agents...
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>System Agents</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0', fontSize: 14 }}>
            Manage platform-level agent definitions available across all organizations.
          </p>
        </div>
        <button
          onClick={() => navigate('/system/agents/new')}
          style={{
            padding: '10px 20px', background: '#6366f1', color: '#fff',
            border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
        >
          + New System Agent
        </button>
      </div>

      {deleteId && (
        <ConfirmDialog
          title="Delete system agent"
          message="Are you sure you want to delete this system agent? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {agents.length === 0 ? (
          <div style={{ padding: '64px 48px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🤖</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>No system agents yet</div>
            <div style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>Create your first system agent to get started.</div>
            <button
              onClick={() => navigate('/system/agents/new')}
              style={{ padding: '10px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}
            >
              + New System Agent
            </button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 13 }}>Name</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 13 }}>Slug</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 13 }}>Status</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 13 }}>Published</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 13 }}>System Skills</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 13 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const skillCount = agent.defaultSystemSkillSlugs?.length ?? 0;
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
                      <code style={{ fontSize: 12, background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, color: '#475569' }}>{agent.slug}</code>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <StatusBadge status={agent.status} />
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <PublishedBadge published={agent.isPublished} />
                    </td>
                    <td style={{ padding: '12px 16px', color: '#475569', fontSize: 13 }}>
                      {skillCount} {skillCount === 1 ? 'skill' : 'skills'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Link
                          to={`/system/agents/${agent.id}`}
                          style={{ padding: '4px 10px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', textDecoration: 'none', fontWeight: 500 }}
                        >
                          Edit
                        </Link>
                        {!agent.isPublished && (
                          <button
                            onClick={() => handlePublish(agent.id)}
                            style={{ padding: '4px 10px', background: '#dcfce7', color: '#166534', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                          >
                            Publish
                          </button>
                        )}
                        {agent.isPublished && (
                          <button
                            onClick={() => handleUnpublish(agent.id)}
                            style={{ padding: '4px 10px', background: '#fff7ed', color: '#9a3412', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                          >
                            Unpublish
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
