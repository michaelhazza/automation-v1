import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';
import ConfirmDialog from '../components/ConfirmDialog';
import { toast } from 'sonner';

interface SystemEngine {
  id: string;
  name: string;
  engineType: string;
  baseUrl: string;
  status: string;
  scope: string;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  createdAt: string;
}

const inputCls = 'block w-full mt-1 px-3 py-2 border border-slate-200 rounded-md text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function SystemEnginesPage({ user }: { user: User }) {
  const [engines, setEngines] = useState<SystemEngine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', engineType: 'n8n', baseUrl: '', apiKey: '' });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = () => {
    api.get('/api/system/engines')
      .then(({ data }) => setEngines(data))
      .catch((err) => { console.error('[SystemEngines] Failed to load engines:', err); setError('Failed to load system engines'); })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleCreate = async () => {
    try {
      await api.post('/api/system/engines', form);
      setShowCreate(false);
      setForm({ name: '', engineType: 'n8n', baseUrl: '', apiKey: '' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create engine');
    }
  };

  const handleToggleStatus = async (engine: SystemEngine) => {
    const newStatus = engine.status === 'active' ? 'inactive' : 'active';
    await api.patch(`/api/system/engines/${engine.id}`, { status: newStatus });
    load();
  };

  const handleConfirmDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/system/engines/${deleteId}`);
      toast.success('Engine deleted');
      load();
    } catch {
      toast.error('Failed to delete engine');
    } finally {
      setDeleteId(null);
    }
  };

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <>
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">System Engines</h1>
          <p className="text-slate-500 mt-2 mb-0">Platform-level execution engines (fallback for all orgs/subaccounts)</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg px-5 py-2.5 cursor-pointer font-semibold transition-colors">
          + New Engine
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-5 text-red-600 text-[14px]">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[13px]">Name</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[13px]">Type</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[13px]">Base URL</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[13px]">Status</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600 text-[13px]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {engines.map(e => (
              <tr key={e.id}>
                <td className="px-4 py-3 font-semibold text-slate-800">{e.name}</td>
                <td className="px-4 py-3 text-[13px] text-slate-600 uppercase">{e.engineType}</td>
                <td className="px-4 py-3 font-mono text-[13px] text-slate-600">{e.baseUrl}</td>
                <td className="px-4 py-3">
                  <span className={`font-semibold text-[13px] ${e.status === 'active' ? 'text-green-600' : 'text-slate-400'}`}>{e.status}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => handleToggleStatus(e)} className={`px-3 py-1 text-white border-0 rounded-md cursor-pointer text-[13px] transition-colors ${e.status === 'active' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-green-600 hover:bg-green-700'}`}>
                      {e.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => setDeleteId(e.id)} className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white border-0 rounded-md cursor-pointer text-[13px] transition-colors">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {engines.length === 0 && (
              <tr><td colSpan={5} className="py-10 text-center text-slate-400">No system engines yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex justify-center items-center z-50">
          <div className="bg-white rounded-xl p-8 w-[460px]">
            <h2 className="m-0 mb-5 text-[20px] font-bold text-slate-800">New System Engine</h2>
            <label className="block mb-3">
              <span className="text-[14px] font-semibold text-slate-700">Name</span>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} />
            </label>
            <label className="block mb-3">
              <span className="text-[14px] font-semibold text-slate-700">Engine Type</span>
              <select value={form.engineType} onChange={e => setForm({ ...form, engineType: e.target.value })} className={inputCls}>
                <option value="n8n">n8n</option>
                <option value="make">Make</option>
                <option value="zapier">Zapier</option>
                <option value="ghl">GHL</option>
                <option value="custom_webhook">Custom Webhook</option>
              </select>
            </label>
            <label className="block mb-3">
              <span className="text-[14px] font-semibold text-slate-700">Base URL</span>
              <input value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://n8n.example.com" className={inputCls} />
            </label>
            <label className="block mb-5">
              <span className="text-[14px] font-semibold text-slate-700">API Key (optional)</span>
              <input value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} type="password" className={inputCls} />
            </label>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-md cursor-pointer transition-colors">Cancel</button>
              <button onClick={handleCreate} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-md cursor-pointer font-semibold transition-colors">Create</button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Engine"
          message="Are you sure? This cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </>
  );
}
