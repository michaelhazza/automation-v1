import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';

interface SystemProcess {
  id: string;
  name: string;
  description: string | null;
  status: string;
  scope: string;
  webhookPath: string;
  requiredConnections: Array<{ key: string; provider: string; required: boolean }> | null;
  isEditable: boolean;
  createdAt: string;
}

const STATUS_CLS: Record<string, string> = {
  active:   'text-green-600',
  draft:    'text-amber-600',
  inactive: 'text-slate-400',
};

const inputCls = 'w-full mt-1 px-3 py-2 border border-slate-200 rounded-md text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function SystemProcessesPage({ user }: { user: User }) {
  const [processes, setProcesses] = useState<SystemProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', webhookPath: '', inputSchema: '', configSchema: '' });

  const load = () => {
    api.get('/api/system/processes')
      .then(({ data }) => setProcesses(data))
      .catch(() => setError('Failed to load system processes'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleCreate = async () => {
    try {
      await api.post('/api/system/processes', form);
      setShowCreate(false);
      setForm({ name: '', description: '', webhookPath: '', inputSchema: '', configSchema: '' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create process');
    }
  };

  const handleActivate = async (id: string) => {
    await api.post(`/api/system/processes/${id}/activate`);
    load();
  };

  const handleDeactivate = async (id: string) => {
    await api.post(`/api/system/processes/${id}/deactivate`);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this system process?')) return;
    await api.delete(`/api/system/processes/${id}`);
    load();
  };

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <>
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">System Workflows</h1>
          <p className="text-slate-500 mt-2 mb-0">Platform-level workflow templates available to all organisations</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg px-5 py-2.5 cursor-pointer font-semibold transition-colors">
          + New Workflow
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
              <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[13px]">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[13px]">Webhook Path</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[13px]">Connections</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600 text-[13px]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {processes.map(p => (
              <tr key={p.id}>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-800">{p.name}</div>
                  {p.description && <div className="text-[13px] text-slate-500 mt-0.5">{p.description}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className={`font-semibold text-[13px] capitalize ${STATUS_CLS[p.status] ?? 'text-slate-500'}`}>{p.status}</span>
                </td>
                <td className="px-4 py-3 font-mono text-[13px] text-slate-600">{p.webhookPath}</td>
                <td className="px-4 py-3 text-[13px] text-slate-500">
                  {p.requiredConnections?.length ?? 0} slots
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-2 justify-end">
                    {(p.status === 'draft' || p.status === 'inactive') ? (
                      <button onClick={() => handleActivate(p.id)} className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white border-0 rounded-md cursor-pointer text-[13px] transition-colors">Activate</button>
                    ) : (
                      <button onClick={() => handleDeactivate(p.id)} className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white border-0 rounded-md cursor-pointer text-[13px] transition-colors">Deactivate</button>
                    )}
                    <button onClick={() => handleDelete(p.id)} className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white border-0 rounded-md cursor-pointer text-[13px] transition-colors">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {processes.length === 0 && (
              <tr><td colSpan={5} className="py-10 text-center text-slate-400">No system processes yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex justify-center items-center z-50">
          <div className="bg-white rounded-xl p-8 w-[500px] max-h-[90vh] overflow-auto">
            <h2 className="m-0 mb-5 text-[20px] font-bold text-slate-800">New System Process</h2>
            <label className="block mb-3">
              <span className="text-[14px] font-semibold text-slate-700">Name</span>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} />
            </label>
            <label className="block mb-3">
              <span className="text-[14px] font-semibold text-slate-700">Description</span>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-md text-[14px] bg-white resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </label>
            <label className="block mb-3">
              <span className="text-[14px] font-semibold text-slate-700">Webhook Path</span>
              <input value={form.webhookPath} onChange={e => setForm({ ...form, webhookPath: e.target.value })} placeholder="/webhook/my-process" className={inputCls} />
            </label>
            <label className="block mb-3">
              <span className="text-[14px] font-semibold text-slate-700">Input Schema (JSON)</span>
              <textarea value={form.inputSchema} onChange={e => setForm({ ...form, inputSchema: e.target.value })} rows={3} className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-md text-[13px] font-mono bg-white resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </label>
            <label className="block mb-5">
              <span className="text-[14px] font-semibold text-slate-700">Config Schema (JSON)</span>
              <textarea value={form.configSchema} onChange={e => setForm({ ...form, configSchema: e.target.value })} rows={3} className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-md text-[13px] font-mono bg-white resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </label>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-md cursor-pointer transition-colors">Cancel</button>
              <button onClick={handleCreate} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-md cursor-pointer font-semibold transition-colors">Create</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
