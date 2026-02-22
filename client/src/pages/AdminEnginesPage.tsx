import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface Engine {
  id: string;
  name: string;
  engineType: string;
  status: string;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
}

export default function AdminEnginesPage({ user }: { user: User }) {
  const [engines, setEngines] = useState<Engine[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', engineType: 'n8n', baseUrl: '', apiKey: '' });
  const [error, setError] = useState('');
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    const { data } = await api.get('/api/engines');
    setEngines(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setError('');
    try {
      await api.post('/api/engines', form);
      setShowForm(false);
      setForm({ name: '', engineType: 'n8n', baseUrl: '', apiKey: '' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create engine');
    }
  };

  const handleTest = async (id: string) => {
    setTestResults((prev) => ({ ...prev, [id]: 'Testing...' }));
    try {
      const { data } = await api.post(`/api/engines/${id}/test`);
      setTestResults((prev) => ({ ...prev, [id]: data.success ? `OK (${data.responseTimeMs}ms)` : data.message }));
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setTestResults((prev) => ({ ...prev, [id]: e.response?.data?.error ?? 'Test failed' }));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    await api.delete(`/api/engines/${deleteId}`);
    setDeleteId(null);
    load();
  };

  const handleToggle = async (engine: Engine) => {
    const newStatus = engine.status === 'active' ? 'inactive' : 'active';
    await api.patch(`/api/engines/${engine.id}`, { status: newStatus });
    load();
  };

  if (loading) return <div>Loading...</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>Workflow Engines</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>Manage automation engine connections</p>
        </div>
        <button onClick={() => { setShowForm(true); setError(''); }} style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}>
          + Add engine
        </button>
      </div>

      {showForm && (
        <Modal title="New engine" onClose={() => setShowForm(false)} maxWidth={560}>
          {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Engine type</label>
              <select value={form.engineType} onChange={(e) => setForm({ ...form, engineType: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}>
                {['n8n', 'ghl', 'make', 'zapier', 'custom_webhook'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Base URL</label>
              <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} placeholder="https://your-n8n.example.com" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>API Key (optional)</label>
              <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
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
          title="Delete engine"
          message="Are you sure you want to delete this engine? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {engines.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 10, padding: '48px', textAlign: 'center', color: '#64748b', border: '1px solid #e2e8f0' }}>No engines configured yet.</div>
        ) : engines.map((engine) => (
          <div key={engine.id} style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: 4 }}>{engine.name}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{engine.engineType}</div>
              {testResults[engine.id] && <div style={{ fontSize: 12, color: '#2563eb', marginTop: 4 }}>{testResults[engine.id]}</div>}
              {engine.lastTestedAt && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Last tested: {new Date(engine.lastTestedAt).toLocaleString()} — {engine.lastTestStatus}</div>}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: engine.status === 'active' ? '#16a34a' : '#6b7280', fontWeight: 500 }}>{engine.status}</span>
              <button onClick={() => handleTest(engine.id)} style={{ padding: '6px 14px', background: '#f0f9ff', color: '#0284c7', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Test</button>
              <button onClick={() => handleToggle(engine)} style={{ padding: '6px 14px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
                {engine.status === 'active' ? 'Deactivate' : 'Activate'}
              </button>
              <button onClick={() => setDeleteId(engine.id)} style={{ padding: '6px 14px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
