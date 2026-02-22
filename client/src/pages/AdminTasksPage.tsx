import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Task {
  id: string;
  name: string;
  description: string;
  status: string;
  categoryId: string | null;
  workflowEngineId: string;
}

interface Category {
  id: string;
  name: string;
  colour: string | null;
}

interface Engine {
  id: string;
  name: string;
  status: string;
  engineType: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: '#16a34a',
  inactive: '#6b7280',
  draft: '#d97706',
};

export default function AdminTasksPage({ user }: { user: User }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', workflowEngineId: '', categoryId: '', endpointUrl: '', httpMethod: 'POST', inputGuidance: '', expectedOutput: '', timeoutSeconds: 300 });
  const [error, setError] = useState('');

  const load = async () => {
    const [taskRes, catRes, engRes] = await Promise.all([
      api.get('/api/tasks'),
      api.get('/api/categories'),
      api.get('/api/engines'),
    ]);
    setTasks(taskRes.data);
    setCategories(catRes.data);
    setEngines(engRes.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setError('');
    try {
      await api.post('/api/tasks', { ...form, categoryId: form.categoryId || undefined });
      setShowForm(false);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create task');
    }
  };

  const handleActivate = async (id: string) => {
    await api.post(`/api/tasks/${id}/activate`);
    load();
  };

  const handleDeactivate = async (id: string) => {
    await api.post(`/api/tasks/${id}/deactivate`);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this task?')) return;
    await api.delete(`/api/tasks/${id}`);
    load();
  };

  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));

  if (loading) return <Layout user={user}><div>Loading...</div></Layout>;

  return (
    <Layout user={user}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>Manage Tasks</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>Create and configure automation tasks</p>
        </div>
        <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}>
          + Create task
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 24, border: '1px solid #e2e8f0', marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>New task</h2>
          {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Name *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} /></div>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Engine *</label>
              <select value={form.workflowEngineId} onChange={(e) => setForm({ ...form, workflowEngineId: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}>
                <option value="">Select engine...</option>
                {engines.filter((e) => e.status === 'active').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Description</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }} /></div>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Endpoint URL *</label>
              <input value={form.endpointUrl} onChange={(e) => setForm({ ...form, endpointUrl: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} /></div>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>HTTP Method *</label>
              <select value={form.httpMethod} onChange={(e) => setForm({ ...form, httpMethod: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}>
                {['GET', 'POST', 'PUT', 'PATCH'].map((m) => <option key={m} value={m}>{m}</option>)}
              </select></div>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Category</label>
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}>
                <option value="">No category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Timeout (seconds)</label>
              <input type="number" value={form.timeoutSeconds} onChange={(e) => setForm({ ...form, timeoutSeconds: Number(e.target.value) })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} /></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Input guidance</label>
              <textarea value={form.inputGuidance} onChange={(e) => setForm({ ...form, inputGuidance: e.target.value })} rows={2} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }} /></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Expected output</label>
              <textarea value={form.expectedOutput} onChange={(e) => setForm({ ...form, expectedOutput: e.target.value })} rows={2} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }} /></div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleCreate} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Create</button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {tasks.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}>No tasks yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Name</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Category</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Status</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 500, color: '#1e293b' }}>{task.name}</td>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>{task.categoryId ? catMap[task.categoryId]?.name : '-'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ color: STATUS_COLORS[task.status] ?? '#6b7280', fontWeight: 500 }}>{task.status}</span>
                  </td>
                  <td style={{ padding: '12px 16px', display: 'flex', gap: 8 }}>
                    <Link to={`/admin/tasks/${task.id}`} style={{ padding: '4px 10px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', textDecoration: 'none' }}>Edit</Link>
                    {task.status !== 'active' && (
                      <button onClick={() => handleActivate(task.id)} style={{ padding: '4px 10px', background: '#dcfce7', color: '#16a34a', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Activate</button>
                    )}
                    {task.status === 'active' && (
                      <button onClick={() => handleDeactivate(task.id)} style={{ padding: '4px 10px', background: '#fef9c3', color: '#a16207', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Deactivate</button>
                    )}
                    <button onClick={() => handleDelete(task.id)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
