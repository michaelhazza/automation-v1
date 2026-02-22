import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User, setActiveOrg } from '../lib/auth';

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
    // Store role so the API interceptor picks it up immediately (already set on login, but ensure it)
    navigate('/');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this organisation?')) return;
    await api.delete(`/api/organisations/${id}`);
    load();
  };

  if (loading) return <div>Loading...</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>Organisations</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>Manage all organisations on the platform</p>
        </div>
        <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}>
          + Create organisation
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 24, border: '1px solid #e2e8f0', marginBottom: 24, maxWidth: 600 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>New organisation</h2>
          {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
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
            <button onClick={handleCreate} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Create</button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
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
                      onClick={() => handleAdminister(org)}
                      style={{ padding: '4px 10px', background: '#eff6ff', color: '#2563eb', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                    >
                      Administer
                    </button>
                    <button onClick={() => handleDelete(org.id)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Delete</button>
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
