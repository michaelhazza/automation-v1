import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface Process {
  id: string;
  name: string;
  description: string;
  status: string;
  orgCategoryId: string | null;
  workflowEngineId: string;
}

interface Category { id: string; name: string; colour: string | null; }
interface Engine { id: string; name: string; status: string; engineType: string; }

const STATUS_TEXT: Record<string, string> = {
  active:   'text-green-600',
  inactive: 'text-slate-500',
  draft:    'text-amber-600',
};

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function AdminTasksPage({ user: _user }: { user: User }) {
  const [processes, setProcesses] = useState<Process[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', workflowEngineId: '', orgCategoryId: '', webhookPath: '', inputSchema: '', outputSchema: '' });
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    const [processRes, catRes, engRes] = await Promise.all([
      api.get('/api/processes'),
      api.get('/api/categories'),
      api.get('/api/engines'),
    ]);
    setProcesses(processRes.data);
    setCategories(catRes.data);
    setEngines(engRes.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setError('');
    try {
      await api.post('/api/processes', { ...form, orgCategoryId: form.orgCategoryId || undefined });
      setShowForm(false);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create process');
    }
  };

  const handleActivate = async (id: string) => { await api.post(`/api/processes/${id}/activate`); load(); };
  const handleDeactivate = async (id: string) => { await api.post(`/api/processes/${id}/deactivate`); load(); };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    await api.delete(`/api/processes/${deleteId}`);
    setDeleteId(null);
    load();
  };

  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">Manage Workflows</h1>
          <p className="text-sm text-slate-500 mt-2">Create and configure workflows</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setError(''); }}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          + Create workflow
        </button>
      </div>

      {showForm && (
        <Modal title="New process" onClose={() => setShowForm(false)} maxWidth={640}>
          {error && <div className="text-[13px] text-red-600 mb-3">{error}</div>}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Engine *</label>
              <select value={form.workflowEngineId} onChange={(e) => setForm({ ...form, workflowEngineId: e.target.value })} className={inputCls}>
                <option value="">Select engine...</option>
                {engines.filter((e) => e.status === 'active').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className={`${inputCls} resize-vertical`} />
            </div>
            <div className="col-span-2">
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Webhook path *</label>
              <input value={form.webhookPath} onChange={(e) => setForm({ ...form, webhookPath: e.target.value })} placeholder="/webhook/my-workflow-id" className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Category</label>
              <select value={form.orgCategoryId} onChange={(e) => setForm({ ...form, orgCategoryId: e.target.value })} className={inputCls}>
                <option value="">No category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Input schema / guidance</label>
              <textarea value={form.inputSchema} onChange={(e) => setForm({ ...form, inputSchema: e.target.value })} rows={2} className={`${inputCls} resize-vertical`} />
            </div>
            <div className="col-span-2">
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Output schema / description</label>
              <textarea value={form.outputSchema} onChange={(e) => setForm({ ...form, outputSchema: e.target.value })} rows={2} className={`${inputCls} resize-vertical`} />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleCreate} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors">Create</button>
            <button onClick={() => setShowForm(false)} className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-medium rounded-lg transition-colors">Cancel</button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete process"
          message="Are you sure you want to delete this process? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {processes.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">No processes yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Name</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Category</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {processes.map((process) => (
                <tr key={process.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{process.name}</td>
                  <td className="px-4 py-3 text-[13px] text-slate-500">
                    {process.orgCategoryId ? catMap[process.orgCategoryId]?.name : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`font-medium capitalize text-[13px] ${STATUS_TEXT[process.status] ?? 'text-slate-500'}`}>
                      {process.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Link
                        to={`/admin/processes/${process.id}`}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium no-underline transition-colors"
                      >
                        Edit
                      </Link>
                      {process.status !== 'active' && (
                        <button onClick={() => handleActivate(process.id)} className="px-2.5 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded-md text-xs font-medium transition-colors">
                          Activate
                        </button>
                      )}
                      {process.status === 'active' && (
                        <button onClick={() => handleDeactivate(process.id)} className="px-2.5 py-1 bg-yellow-50 hover:bg-yellow-100 text-yellow-700 rounded-md text-xs font-medium transition-colors">
                          Deactivate
                        </button>
                      )}
                      <button onClick={() => setDeleteId(process.id)} className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-md text-xs font-medium transition-colors">
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
    </div>
  );
}
