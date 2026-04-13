import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import api from '../lib/api';
import ConfirmDialog from '../components/ConfirmDialog';

interface OrgAgentConfig {
  id: string;
  agentId: string;
  agentName?: string;
  scheduleEnabled: boolean;
  scheduleCron: string | null;
  heartbeatEnabled: boolean;
  heartbeatIntervalHours: number | null;
  heartbeatOffsetMinutes: number | null;
  isActive: boolean;
  createdAt: string;
}

export default function OrgAgentConfigsPage({ embedded }: { embedded?: boolean } = {}) {
  const [configs, setConfigs] = useState<OrgAgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [executionEnabled, setExecutionEnabled] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      const [configRes, settingRes] = await Promise.all([
        api.get('/api/org/agent-configs'),
        api.get('/api/org/settings/execution-enabled'),
      ]);
      setConfigs(configRes.data);
      setExecutionEnabled(settingRes.data?.enabled ?? false);
    } catch { setError('Failed to load org agent configs'); }
    finally { setLoading(false); }
  }

  async function toggleExecution() {
    try {
      await api.patch('/api/org/settings/execution-enabled', { enabled: !executionEnabled });
      setExecutionEnabled(!executionEnabled);
      toast.success(executionEnabled ? 'Execution disabled' : 'Execution enabled');
    } catch { toast.error('Failed to toggle execution'); }
  }

  async function handleToggleActive(config: OrgAgentConfig) {
    try {
      await api.patch(`/api/org/agent-configs/${config.id}`, { isActive: !config.isActive });
      toast.success(config.isActive ? 'Agent deactivated' : 'Agent activated');
      await load();
    } catch { toast.error('Failed to update config'); }
  }

  async function handleDeleteConfirm() {
    if (!deleteId) return;
    try {
      await api.delete(`/api/org/agent-configs/${deleteId}`);
      setConfigs(configs.filter(c => c.id !== deleteId));
      toast.success('Config deleted');
    } catch { toast.error('Failed to delete config'); }
    finally { setDeleteId(null); }
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
      {!embedded && (
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-[24px] font-bold text-slate-900 mt-0 mb-1">Org Agent Configs</h1>
            <p className="text-[14px] text-slate-500 m-0">Organisation-level agent execution settings and schedules.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg mb-4 text-[14px] flex justify-between items-center">
          {error}
          <button onClick={() => setError('')} className="bg-transparent border-0 cursor-pointer text-red-700 text-lg">&times;</button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6 flex items-center justify-between">
        <div>
          <div className="font-semibold text-[14px] text-slate-800">Org-Level Execution</div>
          <div className="text-[12px] text-slate-500 mt-0.5">Enable or disable all org-level agent runs</div>
        </div>
        <button
          onClick={toggleExecution}
          className={`w-12 h-6 rounded-full relative cursor-pointer border-0 transition-colors ${executionEnabled ? 'bg-green-500' : 'bg-slate-300'}`}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${executionEnabled ? 'left-6' : 'left-0.5'}`} />
        </button>
      </div>

      {configs.length === 0 ? (
        <div className="py-10 text-center text-[14px] text-slate-400">No org-level agent configs. These are created when agents are configured to run at the organisation level.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {configs.map(config => (
            <div key={config.id} className="px-5 py-4 bg-white border border-slate-200 rounded-xl flex items-center gap-4">
              <button
                onClick={() => handleToggleActive(config)}
                className={`w-10 h-5 rounded-full relative cursor-pointer border-0 transition-colors ${config.isActive ? 'bg-green-500' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${config.isActive ? 'left-5' : 'left-0.5'}`} />
              </button>
              <div className="flex-1">
                <div className="font-semibold text-[14px] text-slate-800">{config.agentName ?? config.agentId}</div>
                <div className="text-[12px] text-slate-500 flex gap-3 mt-0.5 flex-wrap">
                  {config.scheduleEnabled && config.scheduleCron && <span>Cron: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">{config.scheduleCron}</code></span>}
                  {config.heartbeatEnabled && <span>Heartbeat: every {config.heartbeatIntervalHours}h</span>}
                  {config.heartbeatOffsetMinutes ? <span>Offset: {config.heartbeatOffsetMinutes}m</span> : null}
                  <span className="text-slate-400">{new Date(config.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              <button onClick={() => setDeleteId(config.id)} className="bg-transparent border-0 text-slate-300 hover:text-red-400 cursor-pointer text-lg px-2">&times;</button>
            </div>
          ))}
        </div>
      )}
      {deleteId && (
        <ConfirmDialog
          title="Delete Config"
          message="Delete this org agent config? This cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
