import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Task {
  id: string;
  name: string;
  description: string | null;
  status: string;
  subaccountId: string;
  subaccountCategoryId: string | null;
  workflowEngineId: string;
  webhookPath: string;
  inputSchema: string | null;
  outputSchema: string | null;
}

interface Category {
  id: string;
  name: string;
}

export default function AdminSubaccountTaskEditPage({ user }: { user: User }) {
  const { subaccountId, taskId } = useParams<{ subaccountId: string; taskId: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      const [taskRes, catRes] = await Promise.all([
        api.get(`/api/subaccounts/${subaccountId}/tasks/native/${taskId}`),
        api.get(`/api/subaccounts/${subaccountId}/categories`),
      ]);
      setTask(taskRes.data);
      setCategories(catRes.data);
      setLoading(false);
    };
    load();
  }, [subaccountId, taskId]);

  const handleSave = async () => {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api.patch(`/api/subaccounts/${subaccountId}/tasks/native/${taskId}`, {
        name: task!.name,
        description: task!.description,
        webhookPath: task!.webhookPath,
        inputSchema: task!.inputSchema,
        outputSchema: task!.outputSchema,
        subaccountCategoryId: task!.subaccountCategoryId,
      });
      setSuccess('Task saved successfully');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !task) return <div>Loading...</div>;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Link to={`/admin/subaccounts/${subaccountId}/tasks`} style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none' }}>← Back to tasks</Link>
      </div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', marginBottom: 24 }}>Edit task: {task.name}</h1>

      <div style={{ background: '#fff', borderRadius: 10, padding: 24, border: '1px solid #e2e8f0', maxWidth: 640 }}>
        {success && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#16a34a', fontSize: 13 }}>{success}</div>}
        {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Name</label>
            <input
              type="text"
              value={task.name}
              onChange={(e) => setTask({ ...task, name: e.target.value })}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Webhook path</label>
            <input
              type="text"
              value={task.webhookPath}
              onChange={(e) => setTask({ ...task, webhookPath: e.target.value })}
              placeholder="/webhook/my-workflow-id"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Portal category</label>
            <select
              value={task.subaccountCategoryId ?? ''}
              onChange={(e) => setTask({ ...task, subaccountCategoryId: e.target.value || null })}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
            >
              <option value="">No category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Description</label>
            <textarea
              value={task.description ?? ''}
              onChange={(e) => setTask({ ...task, description: e.target.value })}
              rows={3}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Input schema / guidance</label>
            <textarea
              value={task.inputSchema ?? ''}
              onChange={(e) => setTask({ ...task, inputSchema: e.target.value })}
              rows={2}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Output schema / description</label>
            <textarea
              value={task.outputSchema ?? ''}
              onChange={(e) => setTask({ ...task, outputSchema: e.target.value })}
              rows={2}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }}
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          style={{ marginTop: 20, padding: '10px 24px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </>
  );
}
