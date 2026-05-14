import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface Category {
  id: string;
  name: string;
  description: string | null;
  colour: string | null;
}

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function AdminCategoriesPage({ user: _user, embedded }: { user: User; embedded?: boolean }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', colour: '#6366f1' });
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    const { data } = await api.get('/api/categories');
    setCategories(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setError('');
    try {
      if (editId) {
        await api.patch(`/api/categories/${editId}`, form);
      } else {
        await api.post('/api/categories', form);
      }
      setShowForm(false); setEditId(null); setForm({ name: '', description: '', colour: '#6366f1' }); load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Save failed');
    }
  };

  const handleEdit = (cat: Category) => {
    setEditId(cat.id);
    setForm({ name: cat.name, description: cat.description ?? '', colour: cat.colour ?? '#6366f1' });
    setError(''); setShowForm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    await api.delete(`/api/categories/${deleteId}`);
    setDeleteId(null); load();
  };

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        {!embedded ? (
          <div>
            <h1 className="text-[28px] font-bold text-slate-800 m-0">Automation Categories</h1>
            <p className="text-sm text-slate-500 mt-2">Organise automations and control access via categories</p>
          </div>
        ) : <div />}
        <button
          onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', description: '', colour: '#6366f1' }); setError(''); }}
          className="btn btn-primary"
        >
          + Add category
        </button>
      </div>

      {showForm && (
        <Modal title={editId ? 'Edit category' : 'New category'} onClose={() => setShowForm(false)} maxWidth={480}>
          {error && <div className="text-[13px] text-red-600 mb-3">{error}</div>}
          <div className="mb-3">
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
          </div>
          <div className="mb-3">
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className={`${inputCls} resize-vertical`} />
          </div>
          <div className="mb-6">
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Colour</label>
            <div className="flex items-center gap-3">
              <input type="color" value={form.colour} onChange={(e) => setForm({ ...form, colour: e.target.value })} className="w-10 h-8 border-0 cursor-pointer rounded" />
              <span className="text-[13px] text-slate-500">{form.colour}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleSave} className="btn btn-primary">Save</button>
            <button onClick={() => setShowForm(false)} className="btn btn-secondary">Cancel</button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete category"
          message="Are you sure you want to delete this category? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
        {categories.length === 0 ? (
          <div className="col-span-full bg-white border border-slate-200 rounded-xl py-12 text-center text-sm text-slate-500">
            No categories yet.
          </div>
        ) : categories.map((cat) => (
          <div key={cat.id} className="bg-white border border-slate-200 rounded-xl px-6 py-5">
            <div className="flex items-center gap-2.5 mb-2">
              {cat.colour && <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: cat.colour }} />}
              <div className="font-semibold text-slate-800">{cat.name}</div>
            </div>
            {cat.description && <div className="text-[13px] text-slate-500 mb-3">{cat.description}</div>}
            <div className="flex gap-2">
              <button onClick={() => handleEdit(cat)} className="btn btn-xs btn-secondary">Edit</button>
              <button onClick={() => setDeleteId(cat.id)} className="btn btn-xs btn-ghost text-red-600 hover:bg-red-50">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
