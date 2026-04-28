import { useState, useEffect } from 'react';
import api from '../lib/api';
import ConfirmDialog from '../components/ConfirmDialog';
import { toast } from 'sonner';

interface HierarchyTemplate {
  id: string;
  name: string;
  description: string | null;
  agentCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function HierarchyTemplatesPage() {
  const [templates, setTemplates] = useState<HierarchyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      const res = await api.get('/api/hierarchy-templates');
      setTemplates(res.data);
    } catch { setError('Failed to load hierarchy templates'); }
    finally { setLoading(false); }
  }

  async function handleCreate() {
    if (!form.name.trim()) return;
    try {
      setSaving(true);
      await api.post('/api/hierarchy-templates', { name: form.name, description: form.description || null });
      setShowCreate(false);
      setForm({ name: '', description: '' });
      await load();
    } catch { setError('Failed to create template'); }
    finally { setSaving(false); }
  }

  async function handleConfirmDelete() {
    if (!deleteId) return;
    try {
      await api.delete(`/api/hierarchy-templates/${deleteId}`);
      setTemplates(templates.filter(t => t.id !== deleteId));
      toast.success('Template deleted');
    } catch {
      toast.error('Failed to delete template');
    } finally {
      setDeleteId(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="h-6 w-48 rounded mb-4 bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
      </div>
    );
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-[24px] font-bold text-slate-900 mt-0 mb-1">Agent Hierarchy Templates</h1>
          <p className="text-[14px] text-slate-500 m-0">Reusable agent team structures that can be applied to subaccounts.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn-sm btn-primary">
          New Template
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg mb-4 text-[14px] flex justify-between items-center">
          {error}
          <button onClick={() => setError('')} className="bg-transparent border-0 cursor-pointer text-red-700 text-lg">&times;</button>
        </div>
      )}

      {showCreate && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <h3 className="text-[15px] font-semibold text-slate-800 mb-4 mt-0">Create Template</h3>
          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-[12px] text-slate-500 font-medium mb-1">Name</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. Sales Team" />
            </div>
            <div>
              <label className="block text-[12px] text-slate-500 font-medium mb-1">Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[80px] resize-vertical" placeholder="Optional description" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="btn btn-sm btn-secondary">Cancel</button>
            <button onClick={handleCreate} disabled={saving} className="btn btn-sm btn-primary">{saving ? 'Creating...' : 'Create'}</button>
          </div>
        </div>
      )}

      {templates.length === 0 ? (
        <div className="py-10 text-center text-[14px] text-slate-400">No hierarchy templates yet. Create one to save a reusable agent team structure.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(template => (
            <div key={template.id} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-[15px] font-semibold text-slate-800 m-0">{template.name}</h3>
                <button onClick={() => setDeleteId(template.id)} className="bg-transparent border-0 text-slate-300 hover:text-red-400 cursor-pointer text-lg px-1">&times;</button>
              </div>
              {template.description && <p className="text-[13px] text-slate-500 m-0 mb-3">{template.description}</p>}
              <div className="mt-auto pt-3 border-t border-slate-100 text-[12px] text-slate-400 flex justify-between">
                <span>{template.agentCount ?? 0} agents</span>
                <span>{new Date(template.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Template"
          message="Are you sure? This cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
