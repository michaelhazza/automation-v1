import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';

interface SystemProcess {
  id: string;
  name: string;
  description: string | null;
  status: string;
  scope: string;
  webhookPath: string;
  requiredConnections: Array<{ key: string; provider: string; required: boolean }> | null;
  isEditable: boolean;
  createdAt: string;
}

export default function SystemProcessesPage({ user }: { user: User }) {
  const [processes, setProcesses] = useState<SystemProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', webhookPath: '', inputSchema: '', configSchema: '' });

  const load = () => {
    api.get('/api/system/processes')
      .then(({ data }) => setProcesses(data))
      .catch(() => setError('Failed to load system processes'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleCreate = async () => {
    try {
      await api.post('/api/system/processes', form);
      setShowCreate(false);
      setForm({ name: '', description: '', webhookPath: '', inputSchema: '', configSchema: '' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create process');
    }
  };

  const handleActivate = async (id: string) => {
    await api.post(`/api/system/processes/${id}/activate`);
    load();
  };

  const handleDeactivate = async (id: string) => {
    await api.post(`/api/system/processes/${id}/deactivate`);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this system process?')) return;
    await api.delete(`/api/system/processes/${id}`);
    load();
  };

  if (loading) return <div>Loading...</div>;

  const statusColors: Record<string, string> = {
    active: '#16a34a',
    draft: '#ca8a04',
    inactive: '#94a3b8',
  };

  return (
    <>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>System Processes</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>Platform-level process templates available to all organisations</p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 }}>
          + New Process
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
            <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748b', fontSize: 13 }}>Status</th>
            <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748b', fontSize: 13 }}>Webhook Path</th>
            <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748b', fontSize: 13 }}>Connections</th>
            <th style={{ textAlign: 'right', padding: '12px 16px', color: '#64748b', fontSize: 13 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {processes.map(p => (
            <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '12px 16px' }}>
                <div style={{ fontWeight: 600, color: '#1e293b' }}>{p.name}</div>
                {p.description && <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{p.description}</div>}
              </td>
              <td style={{ padding: '12px 16px' }}>
                <span style={{ color: statusColors[p.status] ?? '#64748b', fontWeight: 600, fontSize: 13, textTransform: 'capitalize' }}>{p.status}</span>
              </td>
              <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 13, color: '#475569' }}>{p.webhookPath}</td>
              <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748b' }}>
                {p.requiredConnections?.length ?? 0} slots
              </td>
              <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                {p.status === 'draft' || p.status === 'inactive' ? (
                  <button onClick={() => handleActivate(p.id)} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13, marginRight: 8 }}>Activate</button>
                ) : (
                  <button onClick={() => handleDeactivate(p.id)} style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13, marginRight: 8 }}>Deactivate</button>
                )}
                <button onClick={() => handleDelete(p.id)} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>Delete</button>
              </td>
            </tr>
          ))}
          {processes.length === 0 && (
            <tr><td colSpan={5} style={{ padding: '40px 16px', textAlign: 'center', color: '#94a3b8' }}>No system processes yet</td></tr>
          )}
        </tbody>
      </table>

      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 32, width: 500, maxHeight: '90vh', overflow: 'auto' }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 700 }}>New System Process</h2>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Name</span>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6 }} />
            </label>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Description</span>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6 }} />
            </label>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Webhook Path</span>
              <input value={form.webhookPath} onChange={e => setForm({ ...form, webhookPath: e.target.value })} placeholder="/webhook/my-process" style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6 }} />
            </label>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Input Schema (JSON)</span>
              <textarea value={form.inputSchema} onChange={e => setForm({ ...form, inputSchema: e.target.value })} rows={3} style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontFamily: 'monospace', fontSize: 13 }} />
            </label>
            <label style={{ display: 'block', marginBottom: 20 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Config Schema (JSON)</span>
              <textarea value={form.configSchema} onChange={e => setForm({ ...form, configSchema: e.target.value })} rows={3} style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontFamily: 'monospace', fontSize: 13 }} />
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
