import { useState, useEffect } from 'react';
import api from '../lib/api';
import ConfirmDialog from '../components/ConfirmDialog';
import { toast } from 'sonner';

interface ConnectorConfig {
  id: string;
  name: string;
  connectorType: string;
  enabled: boolean;
  pollingIntervalMinutes: number | null;
  lastSyncAt: string | null;
  syncStatus: string | null;
  createdAt: string;
}

const CONNECTOR_TYPES = [
  { value: 'ghl', label: 'GoHighLevel' },
  { value: 'stripe', label: 'Stripe' },
  { value: 'teamwork', label: 'Teamwork' },
  { value: 'slack', label: 'Slack' },
];

export default function ConnectorConfigsPage() {
  const [connectors, setConnectors] = useState<ConnectorConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ connectorType: 'ghl', pollIntervalMinutes: 60 });
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      const res = await api.get('/api/org/connectors');
      setConnectors(res.data);
    } catch { setError('Failed to load connectors'); }
    finally { setLoading(false); }
  }

  async function handleSync(id: string) {
    try {
      await api.post(`/api/org/connectors/${id}/sync`);
      await load();
    } catch { setError('Sync failed'); }
  }

  async function handleCreate() {
    try {
      setCreating(true);
      await api.post('/api/org/connectors', {
        connectorType: createForm.connectorType,
        pollIntervalMinutes: createForm.pollIntervalMinutes,
      });
      setShowCreate(false);
      setCreateForm({ connectorType: 'ghl', pollIntervalMinutes: 60 });
      await load();
    } catch { setError('Failed to create connector'); }
    finally { setCreating(false); }
  }

  async function handleConfirmDelete() {
    if (!deleteId) return;
    try {
      await api.delete(`/api/org/connectors/${deleteId}`);
      setConnectors(connectors.filter(c => c.id !== deleteId));
      toast.success('Connector deleted');
    } catch {
      toast.error('Failed to delete connector');
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
          <h1 className="text-[24px] font-bold text-slate-900 mt-0 mb-1">Connector Configs</h1>
          <p className="text-[14px] text-slate-500 m-0">Organisation-level data connectors for automatic polling and sync.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[13px] cursor-pointer font-semibold"
        >
          + Add Connector
        </button>
      </div>

      {showCreate && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <h3 className="text-[15px] font-semibold text-slate-800 mb-4 mt-0">Add Connector</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[12px] text-slate-500 font-medium mb-1">Connector Type</label>
              <select
                value={createForm.connectorType}
                onChange={e => setCreateForm({ ...createForm, connectorType: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {CONNECTOR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[12px] text-slate-500 font-medium mb-1">Poll Interval (minutes)</label>
              <input
                type="number"
                value={createForm.pollIntervalMinutes}
                onChange={e => setCreateForm({ ...createForm, pollIntervalMinutes: parseInt(e.target.value) || 60 })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                min={1}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg text-[13px] text-slate-600 cursor-pointer">Cancel</button>
            <button onClick={handleCreate} disabled={creating} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white border-0 rounded-lg text-[13px] cursor-pointer font-semibold">{creating ? 'Creating...' : 'Create'}</button>
          </div>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg mb-4 text-[14px] flex justify-between items-center">
          {error}
          <button onClick={() => setError('')} className="bg-transparent border-0 cursor-pointer text-red-700 text-lg">&times;</button>
        </div>
      )}

      {connectors.length === 0 ? (
        <div className="py-10 text-center text-[14px] text-slate-400">No connectors configured. Connectors enable automatic data syncing from external systems.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {connectors.map(connector => (
            <div key={connector.id} className="px-5 py-4 bg-white border border-slate-200 rounded-xl flex items-center gap-4">
              <div className={`w-2.5 h-2.5 rounded-full ${connector.enabled ? 'bg-green-500' : 'bg-slate-300'}`} />
              <div className="flex-1">
                <div className="font-semibold text-[14px] text-slate-800">{connector.name}</div>
                <div className="text-[12px] text-slate-500 flex gap-3 mt-0.5 flex-wrap">
                  <span>Type: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">{connector.connectorType}</code></span>
                  {connector.pollingIntervalMinutes && <span>Polls: every {connector.pollingIntervalMinutes}m</span>}
                  {connector.lastSyncAt && <span>Last sync: {new Date(connector.lastSyncAt).toLocaleString()}</span>}
                  {connector.syncStatus && <span className={connector.syncStatus === 'error' ? 'text-red-500' : 'text-green-600'}>Status: {connector.syncStatus}</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleSync(connector.id)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg text-[12px] text-slate-600 cursor-pointer">Sync</button>
                <button onClick={() => setDeleteId(connector.id)} className="bg-transparent border-0 text-slate-300 hover:text-red-400 cursor-pointer text-lg px-2">&times;</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Connector"
          message="Are you sure? This cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
