import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface PermissionGroup {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  categoryCount: number;
}

export default function AdminPermissionGroupsPage({ user }: { user: User }) {
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    const { data } = await api.get('/api/permission-groups');
    setGroups(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setError('');
    try {
      await api.post('/api/permission-groups', form);
      setShowForm(false);
      setForm({ name: '', description: '' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create group');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    await api.delete(`/api/permission-groups/${deleteId}`);
    setDeleteId(null);
    load();
  };

  if (loading) return <div>Loading...</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>Permission Groups</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>Control which users can access which task categories</p>
        </div>
        <button onClick={() => { setShowForm(true); setError(''); }} style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}>
          + Create group
        </button>
      </div>

      {showForm && (
        <Modal title="New permission group" onClose={() => setShowForm(false)} maxWidth={480}>
          {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Description (optional)</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleCreate} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>Create</button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete permission group"
          message="Are you sure you want to delete this permission group? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {groups.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 10, padding: '48px', textAlign: 'center', color: '#64748b', border: '1px solid #e2e8f0' }}>No permission groups yet.</div>
        ) : groups.map((group) => (
          <div key={group.id} style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: 4 }}>{group.name}</div>
              {group.description && <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>{group.description}</div>}
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                {group.memberCount} member{group.memberCount !== 1 ? 's' : ''} · {group.categoryCount} categor{group.categoryCount !== 1 ? 'ies' : 'y'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Link to={`/admin/permission-groups/${group.id}`} style={{ padding: '6px 14px', background: '#dbeafe', color: '#1d4ed8', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', textDecoration: 'none' }}>
                Manage
              </Link>
              <button onClick={() => setDeleteId(group.id)} style={{ padding: '6px 14px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
