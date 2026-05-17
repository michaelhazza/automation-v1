import { useState } from 'react';
import api from '../../lib/api';
import Modal from '../Modal';
import ConfirmDialog from '../ConfirmDialog';
import type { Category } from './types';

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
const btnPrimary = 'btn btn-primary';
const btnSecondary = 'btn btn-secondary';

interface CategoriesTabProps {
  subaccountId: string;
  categories: Category[];
  onChange: () => void;
}

export function CategoriesTab({ subaccountId, categories, onChange }: CategoriesTabProps) {
  const [showCatForm, setShowCatForm] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', description: '', colour: '#6366f1' });
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleCreateCategory = async () => {
    setError('');
    try {
      await api.post(`/api/subaccounts/${subaccountId}/categories`, catForm);
      setShowCatForm(false); setCatForm({ name: '', description: '', colour: '#6366f1' }); onChange();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create category');
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCatId) return;
    await api.delete(`/api/subaccounts/${subaccountId}/categories/${deleteCatId}`);
    setDeleteCatId(null); onChange();
  };

  return (
    <>
      {error && <div className="text-[13px] text-red-600 mb-4">{error}</div>}

      <div className="flex justify-between items-center mb-4">
        <h2 className="text-[18px] font-semibold text-slate-800 m-0">Portal categories</h2>
        <button onClick={() => setShowCatForm(true)} className="btn btn-sm btn-primary">
          + Add category
        </button>
      </div>

      {showCatForm && (
        <Modal title="New category" onClose={() => setShowCatForm(false)} maxWidth={400}>
          <div className="grid gap-3.5 mb-5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name *</label>
              <input value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description</label>
              <input value={catForm.description} onChange={(e) => setCatForm({ ...catForm, description: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Colour</label>
              <input type="color" value={catForm.colour} onChange={(e) => setCatForm({ ...catForm, colour: e.target.value })} className="h-9 w-14 p-0.5 border border-slate-200 rounded-md cursor-pointer" />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleCreateCategory} className={btnPrimary}>Create</button>
            <button onClick={() => setShowCatForm(false)} className={btnSecondary}>Cancel</button>
          </div>
        </Modal>
      )}

      {deleteCatId && (
        <ConfirmDialog title="Delete category" message="Delete this category?" confirmLabel="Delete" onConfirm={handleDeleteCategory} onCancel={() => setDeleteCatId(null)} />
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {categories.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">No categories yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Name</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Description</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {categories.map((cat) => (
                <tr key={cat.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {cat.colour && <span className="w-3 h-3 rounded-full shrink-0" style={{ background: cat.colour }} />}
                      <span className="font-medium text-slate-800">{cat.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-[13px]">{cat.description ?? '—'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => setDeleteCatId(cat.id)} className="btn btn-xs btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700">Delete</button>
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
