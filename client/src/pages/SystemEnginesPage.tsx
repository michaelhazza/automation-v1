import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';

interface SystemEngine {
  id: string;
  name: string;
  engineType: string;
  baseUrl: string;
  status: string;
  scope: string;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  createdAt: string;
}

export default function SystemEnginesPage({ user }: { user: User }) {
  const [engines, setEngines] = useState<SystemEngine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', engineType: 'n8n', baseUrl: '', apiKey: '' });

  const load = () => {
    api.get('/api/system/engines')
      .then(({ data }) => setEngines(data))
      .catch(() => setError('Failed to load system engines'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleCreate = async () => {
    try {
      await api.post('/api/system/engines', form);
      setShowCreate(false);
      setForm({ name: '', engineType: 'n8n', baseUrl: '', apiKey: '' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create engine');
    }
  };

  const handleToggleStatus = async (engine: SystemEngine) => {
    const newStatus = engine.status === 'active' ? 'inactive' : 'active';
    await api.patch(`/api/system/engines/${engine.id}`, { status: newStatus });
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this system engine?')) return;
    await api.delete(`/api/system/engines/${id}`);
    load();
  };

  if (loading) return <div>Loading...</div>;

  return (
    <>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>System Engines</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>Platform-level execution engines (fallback for all orgs/subaccounts)</p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 }}>
          + New Engine
        </button>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#dc2626', fontSize: 14 }}>
          {error}
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
            <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748b', fontSize: 13 }}>Name</th>
            <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748b', fontSize: 13 }}>Type</th>
            <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748b', fontSize: 13 }}>Base URL</th>
            <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748b', fontSize: 13 }}>Status</th>
            <th style={{ textAlign: 'right', padding: '12px 16px', color: '#64748b', fontSize: 13 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {engines.map(e => (
            <tr key={e.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1e293b' }}>{e.name}</td>
              <td style={{ padding: '12px 16px', fontSize: 13, color: '#475569', textTransform: 'uppercase' }}>{e.engineType}</td>
              <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 13, color: '#475569' }}>{e.baseUrl}</td>
              <td style={{ padding: '12px 16px' }}>
                <span style={{ color: e.status === 'active' ? '#16a34a' : '#94a3b8', fontWeight: 600, fontSize: 13 }}>{e.status}</span>
              </td>
              <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                <button onClick={() => handleToggleStatus(e)} style={{ background: e.status === 'active' ? '#f59e0b' : '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13, marginRight: 8 }}>
                  {e.status === 'active' ? 'Deactivate' : 'Activate'}
                </button>
                <button onClick={() => handleDelete(e.id)} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>Delete</button>
              </td>
            </tr>
          ))}
          {engines.length === 0 && (
            <tr><td colSpan={5} style={{ padding: '40px 16px', textAlign: 'center', color: '#94a3b8' }}>No system engines yet</td></tr>
          )}
        </tbody>
      </table>

      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 32, width: 460 }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 700 }}>New System Engine</h2>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Name</span>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6 }} />
            </label>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Engine Type</span>
              <select value={form.engineType} onChange={e => setForm({ ...form, engineType: e.target.value })} style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6 }}>
                <option value="n8n">n8n</option>
                <option value="make">Make</option>
                <option value="zapier">Zapier</option>
                <option value="ghl">GHL</option>
                <option value="custom_webhook">Custom Webhook</option>
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Base URL</span>
              <input value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://n8n.example.com" style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6 }} />
            </label>
            <label style={{ display: 'block', marginBottom: 20 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>API Key (optional)</span>
              <input value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} type="password" style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6 }} />
            </label>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreate(false)} style={{ background: '#e2e8f0', color: '#374151', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreate} style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
