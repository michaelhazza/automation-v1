import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface Subaccount {
  id: string;
  name: string;
  slug: string;
}

interface Category {
  id: string;
  name: string;
}

interface Engine {
  id: string;
  name: string;
  status: string;
}

interface OrgTask {
  id: string;
  name: string;
  status: string;
}

interface TaskLink {
  linkId: string;
  taskId: string;
  taskName: string;
  taskStatus: string;
  isActive: boolean;
  subaccountCategoryId: string | null;
}

interface NativeTask {
  id: string;
  name: string;
  description: string | null;
  status: string;
  workflowEngineId: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: '#16a34a',
  inactive: '#6b7280',
  draft: '#d97706',
};

export default function AdminSubaccountTasksPage({ user }: { user: User }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();

  const [sa, setSa] = useState<Subaccount | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [orgTasks, setOrgTasks] = useState<OrgTask[]>([]);
  const [linkedTasks, setLinkedTasks] = useState<TaskLink[]>([]);
  const [nativeTasks, setNativeTasks] = useState<NativeTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Link org task form
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkForm, setLinkForm] = useState({ taskId: '', subaccountCategoryId: '' });
  const [deleteLinkId, setDeleteLinkId] = useState<string | null>(null);

  // Create native task form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '', description: '', workflowEngineId: '',
    webhookPath: '', subaccountCategoryId: '', inputSchema: '', outputSchema: '',
  });
  const [deleteNativeId, setDeleteNativeId] = useState<string | null>(null);

  const load = async () => {
    if (!subaccountId) return;
    try {
      const [saRes, taskRes, catRes] = await Promise.all([
        api.get(`/api/subaccounts/${subaccountId}`),
        api.get(`/api/subaccounts/${subaccountId}/tasks`),
        api.get(`/api/subaccounts/${subaccountId}/categories`),
      ]);
      setSa(saRes.data);
      setLinkedTasks(taskRes.data.linkedTasks ?? []);
      setNativeTasks(taskRes.data.nativeTasks ?? []);
      setCategories(catRes.data);
    } finally {
      setLoading(false);
    }
  };

  const loadOrgData = async () => {
    const [tasksRes, engRes] = await Promise.all([
      api.get('/api/tasks').catch(() => ({ data: [] })),
      api.get('/api/engines').catch(() => ({ data: [] })),
    ]);
    setOrgTasks(tasksRes.data.filter((t: OrgTask) => t.status === 'active'));
    setEngines(engRes.data.filter((e: Engine) => e.status === 'active'));
  };

  useEffect(() => {
    load();
    loadOrgData();
  }, [subaccountId]);

  // ─── Link org task ─────────────────────────────────────────────────────────

  const handleCreateLink = async () => {
    setError('');
    try {
      await api.post(`/api/subaccounts/${subaccountId}/tasks`, {
        taskId: linkForm.taskId,
        subaccountCategoryId: linkForm.subaccountCategoryId || undefined,
      });
      setShowLinkForm(false);
      setLinkForm({ taskId: '', subaccountCategoryId: '' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to link task');
    }
  };

  const handleDeleteLink = async () => {
    if (!deleteLinkId) return;
    await api.delete(`/api/subaccounts/${subaccountId}/tasks/${deleteLinkId}`);
    setDeleteLinkId(null);
    load();
  };

  const handleToggleLinkActive = async (link: TaskLink) => {
    await api.patch(`/api/subaccounts/${subaccountId}/tasks/${link.linkId}`, { isActive: !link.isActive });
    load();
  };

  // ─── Native task CRUD ──────────────────────────────────────────────────────

  const handleCreateNative = async () => {
    setError('');
    try {
      await api.post('/api/tasks', {
        ...createForm,
        subaccountId,
        subaccountCategoryId: createForm.subaccountCategoryId || undefined,
        orgCategoryId: undefined,
      });
      setShowCreateForm(false);
      setCreateForm({ name: '', description: '', workflowEngineId: '', webhookPath: '', subaccountCategoryId: '', inputSchema: '', outputSchema: '' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create task');
    }
  };

  const handleActivateNative = async (id: string) => {
    await api.post(`/api/subaccounts/${subaccountId}/tasks/native/${id}/activate`);
    load();
  };

  const handleDeactivateNative = async (id: string) => {
    await api.post(`/api/subaccounts/${subaccountId}/tasks/native/${id}/deactivate`);
    load();
  };

  const handleDeleteNative = async () => {
    if (!deleteNativeId) return;
    await api.delete(`/api/subaccounts/${subaccountId}/tasks/native/${deleteNativeId}`);
    setDeleteNativeId(null);
    load();
  };

  if (loading || !sa) return <div>Loading...</div>;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Link to={`/admin/subaccounts/${subaccountId}`} style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none' }}>
          ← Back to {sa.name}
        </Link>
      </div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>Tasks</h1>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 32 }}>{sa.name}</div>

      {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {/* ─── Org tasks section ─── */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: '#1e293b' }}>Organisation tasks</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
              Tasks created at the organisation level and linked to this subaccount.
            </p>
          </div>
          <button
            onClick={() => { setShowLinkForm(true); setError(''); }}
            style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            + Link org task
          </button>
        </div>

        {showLinkForm && (
          <Modal title="Link org task to subaccount" onClose={() => setShowLinkForm(false)} maxWidth={400}>
            <div style={{ display: 'grid', gap: 14, marginBottom: 20 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Org task *</label>
                <select
                  value={linkForm.taskId}
                  onChange={(e) => setLinkForm({ ...linkForm, taskId: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                >
                  <option value="">Select task...</option>
                  {orgTasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Portal category (optional)</label>
                <select
                  value={linkForm.subaccountCategoryId}
                  onChange={(e) => setLinkForm({ ...linkForm, subaccountCategoryId: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                >
                  <option value="">No category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={handleCreateLink} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Link</button>
              <button onClick={() => setShowLinkForm(false)} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            </div>
          </Modal>
        )}

        {deleteLinkId && (
          <ConfirmDialog title="Remove task link" message="Remove this task from the subaccount?" confirmLabel="Remove" onConfirm={handleDeleteLink} onCancel={() => setDeleteLinkId(null)} />
        )}

        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          {linkedTasks.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>No org tasks linked yet. Link an org task to make it available in this subaccount.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Task</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Visible in portal</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {linkedTasks.map((link) => (
                  <tr key={link.linkId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 500 }}>{link.taskName}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ color: STATUS_COLORS[link.taskStatus] ?? '#6b7280', fontWeight: 500 }}>{link.taskStatus}</span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <button
                        onClick={() => handleToggleLinkActive(link)}
                        style={{ padding: '3px 10px', background: link.isActive ? '#dcfce7' : '#f1f5f9', color: link.isActive ? '#16a34a' : '#6b7280', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
                      >
                        {link.isActive ? 'Visible' : 'Hidden'}
                      </button>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <button onClick={() => setDeleteLinkId(link.linkId)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Unlink</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ─── Subaccount-native tasks section ─── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: '#1e293b' }}>Subaccount tasks</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
              Tasks created directly for this subaccount. Only available here.
            </p>
          </div>
          <button
            onClick={() => { setShowCreateForm(true); setError(''); }}
            style={{ padding: '8px 16px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            + Create task
          </button>
        </div>

        {showCreateForm && (
          <Modal title="New subaccount task" onClose={() => setShowCreateForm(false)} maxWidth={640}>
            {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Name *</label>
                <input
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Engine *</label>
                <select
                  value={createForm.workflowEngineId}
                  onChange={(e) => setCreateForm({ ...createForm, workflowEngineId: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                >
                  <option value="">Select engine...</option>
                  {engines.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Description</label>
                <textarea
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  rows={2}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Webhook path *</label>
                <input
                  value={createForm.webhookPath}
                  onChange={(e) => setCreateForm({ ...createForm, webhookPath: e.target.value })}
                  placeholder="/webhook/my-workflow-id"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Portal category (optional)</label>
                <select
                  value={createForm.subaccountCategoryId}
                  onChange={(e) => setCreateForm({ ...createForm, subaccountCategoryId: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                >
                  <option value="">No category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Input schema / guidance</label>
                <textarea
                  value={createForm.inputSchema}
                  onChange={(e) => setCreateForm({ ...createForm, inputSchema: e.target.value })}
                  rows={2}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Output schema / description</label>
                <textarea
                  value={createForm.outputSchema}
                  onChange={(e) => setCreateForm({ ...createForm, outputSchema: e.target.value })}
                  rows={2}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={handleCreateNative} style={{ padding: '8px 20px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>Create</button>
              <button onClick={() => setShowCreateForm(false)} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            </div>
          </Modal>
        )}

        {deleteNativeId && (
          <ConfirmDialog title="Delete task" message="Delete this subaccount task? This cannot be undone." confirmLabel="Delete" onConfirm={handleDeleteNative} onCancel={() => setDeleteNativeId(null)} />
        )}

        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          {nativeTasks.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>No subaccount tasks yet. Create one to get started.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Name</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {nativeTasks.map((task) => (
                  <tr key={task.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 500, color: '#1e293b' }}>{task.name}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ color: STATUS_COLORS[task.status] ?? '#6b7280', fontWeight: 500 }}>{task.status}</span>
                    </td>
                    <td style={{ padding: '12px 16px', display: 'flex', gap: 8 }}>
                      <Link
                        to={`/admin/subaccounts/${subaccountId}/tasks/${task.id}/edit`}
                        style={{ padding: '4px 10px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', textDecoration: 'none' }}
                      >
                        Edit
                      </Link>
                      {task.status !== 'active' && (
                        <button onClick={() => handleActivateNative(task.id)} style={{ padding: '4px 10px', background: '#dcfce7', color: '#16a34a', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Activate</button>
                      )}
                      {task.status === 'active' && (
                        <button onClick={() => handleDeactivateNative(task.id)} style={{ padding: '4px 10px', background: '#fef9c3', color: '#a16207', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Deactivate</button>
                      )}
                      <button onClick={() => setDeleteNativeId(task.id)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
