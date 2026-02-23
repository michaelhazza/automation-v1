import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface Task {
  id: string;
  name: string;
  description: string;
  status: string;
  orgCategoryId: string | null;
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
  const [form, setForm] = useState({ name: '', description: '', workflowEngineId: '', orgCategoryId: '', webhookPath: '', inputSchema: '', outputSchema: '' });
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

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
      await api.post('/api/tasks', { ...form, orgCategoryId: form.orgCategoryId || undefined });
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

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    await api.delete(`/api/tasks/${deleteId}`);
    setDeleteId(null);
    load();
  };

  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));

  if (loading) return <div>Loading...</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>Manage Tasks</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>Create and configure automation tasks</p>
        </div>
        <button onClick={() => { setShowForm(true); setError(''); }} style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}>
          + Create task
        </button>
      </div>

      {showForm && (
        <Modal title="New task" onClose={() => setShowForm(false)} maxWidth={640}>
          {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Name *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} /></div>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Engine *</label>
              <select value={form.workflowEngineId} onChange={(e) => setForm({ ...form, workflowEngineId: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}>
                <option value="">Select engine...</option>
                {engines.filter((e) => e.status === 'active').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Description</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }} /></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Webhook path *</label>
              <input value={form.webhookPath} onChange={(e) => setForm({ ...form, webhookPath: e.target.value })} placeholder="/webhook/my-workflow-id" style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} /></div>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Category</label>
              <select value={form.orgCategoryId} onChange={(e) => setForm({ ...form, orgCategoryId: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}>
                <option value="">No category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Input schema / guidance</label>
              <textarea value={form.inputSchema} onChange={(e) => setForm({ ...form, inputSchema: e.target.value })} rows={2} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }} /></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Output schema / description</label>
              <textarea value={form.outputSchema} onChange={(e) => setForm({ ...form, outputSchema: e.target.value })} rows={2} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }} /></div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleCreate} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>Create</button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete task"
          message="Are you sure you want to delete this task? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
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
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>{task.orgCategoryId ? catMap[task.orgCategoryId]?.name : '-'}</td>
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
                    <button onClick={() => setDeleteId(task.id)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Delete</button>
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
