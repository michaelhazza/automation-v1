import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import ConfirmDialog from '../components/ConfirmDialog';

interface SystemSkill {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  methodology: string | null;
  instructions: string | null;
  createdAt: string;
}

const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  active:   { bg: '#dcfce7', color: '#166534' },
  inactive: { bg: '#fff7ed', color: '#9a3412' },
};

export default function SystemSkillsPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const [skills, setSkills] = useState<SystemSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/system/skills');
      setSkills(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/system/skills/${deleteId}`);
      setDeleteId(null);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError((prev) => ({ ...prev, [deleteId]: e.response?.data?.error ?? 'Failed to delete' }));
      setDeleteId(null);
    }
  };

  if (loading) {
    return <div style={{ padding: 48, textAlign: 'center', color: '#64748b', fontSize: 14 }}>Loading...</div>;
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>System Skills</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0', fontSize: 14 }}>
            Platform-level skills that handle task board interactions and core agent capabilities. These are automatically attached to system agents and hidden from organisation admins.
          </p>
        </div>
        <button
          onClick={() => navigate('/system/skills/new')}
          style={{
            padding: '10px 20px', background: '#6366f1', color: '#fff',
            border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
        >
          + New System Skill
        </button>
      </div>

      {deleteId && (
        <ConfirmDialog
          title="Delete system skill"
          message="Are you sure you want to delete this system skill? System agents using it will lose access."
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {skills.length === 0 ? (
          <div style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>&#128295;</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', marginBottom: 6 }}>No system skills yet</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>Create system skills to define core capabilities.</div>
            <button
              onClick={() => navigate('/system/skills/new')}
              style={{ padding: '8px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
            >
              + Create System Skill
            </button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 13 }}>Name</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 13 }}>Slug</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 13 }}>Methodology</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 13 }}>Active</th>
                <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#374151', fontSize: 13 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr key={skill.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 600, color: '#1e293b' }}>{skill.name}</div>
                    {skill.description && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{skill.description}</div>}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <code style={{ fontSize: 12, background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, color: '#475569' }}>{skill.slug}</code>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {skill.methodology ? (
                      <span style={{ fontSize: 12, color: '#166534', background: '#dcfce7', padding: '2px 8px', borderRadius: 4 }}>Has methodology</span>
                    ) : (
                      <span style={{ fontSize: 12, color: '#9a3412', background: '#fff7ed', padding: '2px 8px', borderRadius: 4 }}>No methodology</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                      background: skill.isActive ? STATUS_BADGE.active.bg : STATUS_BADGE.inactive.bg,
                      color: skill.isActive ? STATUS_BADGE.active.color : STATUS_BADGE.inactive.color,
                    }}>
                      {skill.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                      <Link to={`/system/skills/${skill.id}`} style={{ padding: '4px 10px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6, fontSize: 12, textDecoration: 'none', fontWeight: 500 }}>Edit</Link>
                      <button onClick={() => setDeleteId(skill.id)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>Delete</button>
                    </div>
                    {actionError[skill.id] && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>{actionError[skill.id]}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
