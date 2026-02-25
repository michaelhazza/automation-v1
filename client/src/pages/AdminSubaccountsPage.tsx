import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface Subaccount {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: '#16a34a',
  suspended: '#d97706',
  inactive: '#6b7280',
};

export default function AdminSubaccountsPage({ user }: { user: User }) {
  const [subaccounts, setSubaccounts] = useState<Subaccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', status: 'active' });
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    try {
      const { data } = await api.get('/api/subaccounts');
      setSubaccounts(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setError('');
    try {
      await api.post('/api/subaccounts', {
        name: form.name,
        slug: form.slug || undefined,
        status: form.status,
      });
      setShowForm(false);
      setForm({ name: '', slug: '', status: 'active' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      const status = e.response?.status;
      const serverMessage = e.response?.data?.error;
      if (status === 403) {
        setError(serverMessage ?? 'You do not have permission to create subaccounts. Contact your organisation administrator.');
      } else if (status === 409) {
        setError(serverMessage ?? 'A subaccount with this slug already exists. Please choose a different slug.');
      } else {
        setError(serverMessage ?? 'Failed to create subaccount. Please try again.');
      }
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    await api.delete(`/api/subaccounts/${deleteId}`);
    setDeleteId(null);
    load();
  };

  if (loading) return <div>Loading...</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>Subaccounts</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>Manage client subaccounts and their portal access</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setError(''); }}
          style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}
        >
          + New subaccount
        </button>
      </div>

      {showForm && (
        <Modal title="New subaccount" onClose={() => setShowForm(false)} maxWidth={480}>
          {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'grid', gap: 16, marginBottom: 24 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Slug (optional — auto-derived from name)</label>
              <input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="e.g. my-client"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleCreate} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>Create</button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete subaccount"
          message="Are you sure you want to delete this subaccount? Members will lose access."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {subaccounts.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#64748b' }}>No subaccounts yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Name</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Slug</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Status</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {subaccounts.map((sa) => (
                <tr key={sa.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 500, color: '#1e293b' }}>{sa.name}</td>
                  <td style={{ padding: '12px 16px', color: '#64748b', fontFamily: 'monospace', fontSize: 13 }}>{sa.slug}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ color: STATUS_COLORS[sa.status] ?? '#6b7280', fontWeight: 500 }}>{sa.status}</span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Link
                        to={`/admin/subaccounts/${sa.id}`}
                        style={{ padding: '4px 10px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', textDecoration: 'none' }}
                      >
                        Manage
                      </Link>
                      <button
                        onClick={() => setDeleteId(sa.id)}
                        style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    </div>
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
