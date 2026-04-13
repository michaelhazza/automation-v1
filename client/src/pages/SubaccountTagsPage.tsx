import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import ConfirmDialog from '../components/ConfirmDialog';
import { toast } from 'sonner';

interface Tag {
  key: string;
  value: string;
}

export default function SubaccountTagsPage() {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);

  useEffect(() => { load(); }, [subaccountId]);

  async function load() {
    try {
      setLoading(true);
      const res = await api.get(`/api/subaccounts/${subaccountId}/tags`);
      const data = res.data as Record<string, string>;
      setTags(Object.entries(data).map(([key, value]) => ({ key, value })));
    } catch { setError('Failed to load tags'); }
    finally { setLoading(false); }
  }

  async function handleAdd() {
    if (!newKey.trim()) return;
    try {
      setSaving(true);
      await api.put(`/api/subaccounts/${subaccountId}/tags/${encodeURIComponent(newKey)}`, { value: newValue });
      setNewKey('');
      setNewValue('');
      await load();
    } catch { setError('Failed to add tag'); }
    finally { setSaving(false); }
  }

  async function handleConfirmDelete() {
    if (!deleteKey) return;
    try {
      await api.delete(`/api/subaccounts/${subaccountId}/tags/${encodeURIComponent(deleteKey)}`);
      setTags(tags.filter(t => t.key !== deleteKey));
      toast.success('Tag deleted');
    } catch {
      toast.error('Failed to delete tag');
    } finally {
      setDeleteKey(null);
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
      <div className="mb-2">
        <Link to={`/admin/subaccounts/${subaccountId}`} className="text-[14px] text-indigo-600 hover:text-indigo-700 no-underline">&larr; Back to Company</Link>
      </div>
      <div className="mb-6">
        <h1 className="text-[24px] font-bold text-slate-900 mt-2 mb-1">Tags</h1>
        <p className="text-[14px] text-slate-500 m-0">Key-value tags for cohort filtering and cross-subaccount intelligence scoping.</p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg mb-4 text-[14px] flex justify-between items-center">
          {error}
          <button onClick={() => setError('')} className="bg-transparent border-0 cursor-pointer text-red-700 text-lg">&times;</button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
        <h3 className="text-[14px] font-semibold text-slate-800 mb-3 mt-0">Add Tag</h3>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-[12px] text-slate-500 font-medium mb-1">Key</label>
            <input type="text" value={newKey} onChange={e => setNewKey(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. industry" />
          </div>
          <div className="flex-1">
            <label className="block text-[12px] text-slate-500 font-medium mb-1">Value</label>
            <input type="text" value={newValue} onChange={e => setNewValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. saas" />
          </div>
          <button onClick={handleAdd} disabled={saving || !newKey.trim()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white border-0 rounded-lg text-[13px] cursor-pointer font-semibold whitespace-nowrap">{saving ? 'Adding...' : 'Add'}</button>
        </div>
      </div>

      {tags.length === 0 ? (
        <div className="py-10 text-center text-[14px] text-slate-400">No tags set. Add tags to enable cohort filtering and scoped intelligence.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left text-[12px] text-slate-500 font-semibold px-5 py-3">Key</th>
                <th className="text-left text-[12px] text-slate-500 font-semibold px-5 py-3">Value</th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody>
              {tags.map(tag => (
                <tr key={tag.key} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-5 py-3 text-[14px] font-medium text-slate-800">{tag.key}</td>
                  <td className="px-5 py-3 text-[14px] text-slate-600">{tag.value}</td>
                  <td className="px-3 py-3">
                    <button onClick={() => setDeleteKey(tag.key)} className="bg-transparent border-0 text-slate-300 hover:text-red-400 cursor-pointer text-lg px-1">&times;</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleteKey && (
        <ConfirmDialog
          title="Delete Tag"
          message={`Are you sure you want to delete tag "${deleteKey}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteKey(null)}
        />
      )}
    </div>
  );
}
