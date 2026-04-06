import { useState, useEffect } from 'react';
import api from '../lib/api';

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

export default function ConnectorConfigsPage() {
  const [connectors, setConnectors] = useState<ConnectorConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  async function handleDelete(id: string) {
    if (!confirm('Delete this connector?')) return;
    try {
      await api.delete(`/api/org/connectors/${id}`);
      setConnectors(connectors.filter(c => c.id !== id));
    } catch { setError('Failed to delete'); }
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
      <div className="mb-6">
        <h1 className="text-[24px] font-bold text-slate-900 mt-0 mb-1">Connector Configs</h1>
        <p className="text-[14px] text-slate-500 m-0">Organisation-level data connectors for automatic polling and sync.</p>
      </div>

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
                <button onClick={() => handleDelete(connector.id)} className="bg-transparent border-0 text-slate-300 hover:text-red-400 cursor-pointer text-lg px-2">&times;</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
