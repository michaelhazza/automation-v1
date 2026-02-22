import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { User, setActiveOrg } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface Organisation {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  createdAt: string;
}

export default function SystemOrganisationsPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', plan: 'starter', adminEmail: '', adminFirstName: '', adminLastName: '' });
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    const { data } = await api.get('/api/organisations');
    setOrgs(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setError('');
    try {
      await api.post('/api/organisations', form);
      setShowForm(false);
      setForm({ name: '', slug: '', plan: 'starter', adminEmail: '', adminFirstName: '', adminLastName: '' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create organisation');
    }
  };

  const handleUpdateStatus = async (id: string, status: string) => {
    await api.patch(`/api/organisations/${id}`, { status });
    load();
  };

  const handleUpdatePlan = async (id: string, plan: string) => {
    await api.patch(`/api/organisations/${id}`, { plan });
    load();
  };

  const handleAdminister = (org: Organisation) => {
    setActiveOrg(org.id, org.name);
    navigate('/');
  };

  const handleViewUsers = (org: Organisation) => {
    setActiveOrg(org.id, org.name);
    navigate('/admin/users');
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    await api.delete(`/api/organisations/${deleteId}`);
    setDeleteId(null);
    load();
  };

  const deleteOrgName = deleteId ? orgs.find((o) => o.id === deleteId) : null;

  if (loading) return <div>Loading...</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>Organisations</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>Manage all organisations on the platform</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link
            to="/system/users"
            style={{ padding: '10px 20px', background: '#f8fafc', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500, textDecoration: 'none', display: 'inline-block' }}
          >
            System Admins
          </Link>
          <button onClick={() => { setShowForm(true); setError(''); }} style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}>
            + Create organisation
          </button>
        </div>
      </div>

      {showForm && (
        <Modal title="New organisation" onClose={() => setShowForm(false)} maxWidth={600}>
          {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} /></div>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Slug *</label><input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} /></div>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Plan *</label>
              <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}>
                {['starter', 'pro', 'agency'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Admin email *</label><input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} /></div>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Admin first name *</label><input value={form.adminFirstName} onChange={(e) => setForm({ ...form, adminFirstName: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} /></div>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Admin last name *</label><input value={form.adminLastName} onChange={(e) => setForm({ ...form, adminLastName: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} /></div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleCreate} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>Create</button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete organisation"
          message={`Are you sure you want to delete "${deleteOrgName?.name ?? 'this organisation'}"? This action cannot be undone and will remove all associated data.`}
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Name</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Slug</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Plan</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Status</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Created</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((org) => (
              <tr key={org.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px 16px', fontWeight: 500, color: '#1e293b' }}>{org.name}</td>
                <td style={{ padding: '12px 16px', color: '#64748b', fontFamily: 'monospace', fontSize: 13 }}>{org.slug}</td>
                <td style={{ padding: '12px 16px' }}>
                  <select value={org.plan} onChange={(e) => handleUpdatePlan(org.id, e.target.value)} style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
                    {['starter', 'pro', 'agency'].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <select value={org.status} onChange={(e) => handleUpdateStatus(org.id, e.target.value)} style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, color: org.status === 'active' ? '#16a34a' : '#dc2626' }}>
                    <option value="active">active</option>
                    <option value="suspended">suspended</option>
                  </select>
                </td>
                <td style={{ padding: '12px 16px', color: '#64748b', fontSize: 13 }}>{new Date(org.createdAt).toLocaleDateString()}</td>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => handleViewUsers(org)}
                      style={{ padding: '4px 10px', background: '#f0fdf4', color: '#16a34a', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                    >
                      Users
                    </button>
                    <button
                      onClick={() => handleAdminister(org)}
                      style={{ padding: '4px 10px', background: '#eff6ff', color: '#2563eb', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                    >
                      Administer
                    </button>
                    <button onClick={() => setDeleteId(org.id)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
