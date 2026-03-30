import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface Engine {
  id: string;
  name: string;
  engineType: string;
  status: string;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
}

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function AdminEnginesPage({ user: _user, embedded }: { user: User; embedded?: boolean }) {
  const [engines, setEngines] = useState<Engine[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', engineType: 'n8n', baseUrl: '', apiKey: '' });
  const [error, setError] = useState('');
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    const { data } = await api.get('/api/engines');
    setEngines(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setError('');
    try {
      await api.post('/api/engines', form);
      setShowForm(false);
      setForm({ name: '', engineType: 'n8n', baseUrl: '', apiKey: '' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create engine');
    }
  };

  const handleTest = async (id: string) => {
    setTestResults((prev) => ({ ...prev, [id]: 'Testing...' }));
    try {
      const { data } = await api.post(`/api/engines/${id}/test`);
      setTestResults((prev) => ({ ...prev, [id]: data.success ? `OK (${data.responseTimeMs}ms)` : data.message }));
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setTestResults((prev) => ({ ...prev, [id]: e.response?.data?.error ?? 'Test failed' }));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    await api.delete(`/api/engines/${deleteId}`);
    setDeleteId(null); load();
  };

  const handleToggle = async (engine: Engine) => {
    const newStatus = engine.status === 'active' ? 'inactive' : 'active';
    await api.patch(`/api/engines/${engine.id}`, { status: newStatus });
    load();
  };

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        {!embedded ? (
          <div>
            <h1 className="text-[28px] font-bold text-slate-800 m-0">Workflow Engines</h1>
            <p className="text-sm text-slate-500 mt-2">Manage automation engine connections</p>
          </div>
        ) : <div />}
        <button
          onClick={() => { setShowForm(true); setError(''); }}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          + Add engine
        </button>
      </div>

      {showForm && (
        <Modal title="New engine" onClose={() => setShowForm(false)} maxWidth={560}>
          {error && <div className="text-[13px] text-red-600 mb-3">{error}</div>}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Engine type</label>
              <select value={form.engineType} onChange={(e) => setForm({ ...form, engineType: e.target.value })} className={inputCls}>
                {['n8n', 'ghl', 'make', 'zapier', 'custom_webhook'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Base URL</label>
              <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://your-n8n.example.com" className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">API Key (optional)</label>
              <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} className={inputCls} />
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
          title="Delete engine"
          message="Are you sure you want to delete this engine? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div className="flex flex-col gap-4">
        {engines.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl py-12 text-center text-sm text-slate-500">
            No engines configured yet.
          </div>
        ) : engines.map((engine) => (
          <div key={engine.id} className="bg-white border border-slate-200 rounded-xl px-6 py-5 flex justify-between items-center">
            <div>
              <div className="font-semibold text-slate-800 mb-1">{engine.name}</div>
              <div className="text-xs text-slate-500">{engine.engineType}</div>
              {testResults[engine.id] && (
                <div className="text-xs text-blue-600 mt-1">{testResults[engine.id]}</div>
              )}
              {engine.lastTestedAt && (
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Last tested: {new Date(engine.lastTestedAt).toLocaleString()} — {engine.lastTestStatus}
                </div>
              )}
            </div>
            <div className="flex gap-2.5 items-center">
              <span className={`text-xs font-medium ${engine.status === 'active' ? 'text-green-600' : 'text-slate-500'}`}>
                {engine.status}
              </span>
              <button onClick={() => handleTest(engine.id)} className="px-3.5 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 rounded-lg text-[13px] font-medium transition-colors">
                Test
              </button>
              <button onClick={() => handleToggle(engine)} className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[13px] font-medium transition-colors">
                {engine.status === 'active' ? 'Deactivate' : 'Activate'}
              </button>
              <button onClick={() => setDeleteId(engine.id)} className="px-3.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-[13px] font-medium transition-colors">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
