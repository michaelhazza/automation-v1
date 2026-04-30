import React, { useState, useEffect } from 'react';
import { SeatsPanel } from './SeatsPanel';
import { getSubaccountWorkspaceConfig, configureWorkspace } from '../../lib/api';
import { MigrateWorkspaceModal } from './MigrateWorkspaceModal';

type Backend = 'synthetos_native' | 'google_workspace' | null;

interface WorkspaceConfig {
  backend: Backend;
  connectorConfigId: string | null;
  seatUsage: { active: number; suspended: number; total: number };
}

export function WorkspaceTabContent({ subaccountId }: { subaccountId: string }) {
  const [config, setConfig] = useState<WorkspaceConfig | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [selectedBackend, setSelectedBackend] = useState<Backend>(null);
  const [googleDomain, setGoogleDomain] = useState('');
  const [showGoogleForm, setShowGoogleForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migrateOpen, setMigrateOpen] = useState(false);

  useEffect(() => {
    getSubaccountWorkspaceConfig(subaccountId)
      .then((data: WorkspaceConfig) => {
        setConfig(data);
        setSelectedBackend(data.backend);
      })
      .catch(() => {});
  }, [subaccountId]);

  async function handleConfigureNative() {
    setConfiguring(true);
    setError(null);
    try {
      await configureWorkspace(subaccountId, { backend: 'synthetos_native' });
      const updated: WorkspaceConfig = await getSubaccountWorkspaceConfig(subaccountId);
      setConfig(updated);
      setSelectedBackend('synthetos_native');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Configuration failed');
    } finally {
      setConfiguring(false);
    }
  }

  async function handleConfigureGoogle() {
    if (!googleDomain.trim()) return;
    setConfiguring(true);
    setError(null);
    try {
      await configureWorkspace(subaccountId, { backend: 'google_workspace', domain: googleDomain.trim() });
      const updated: WorkspaceConfig = await getSubaccountWorkspaceConfig(subaccountId);
      setConfig(updated);
      setSelectedBackend('google_workspace');
      setShowGoogleForm(false);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Configuration failed');
    } finally {
      setConfiguring(false);
    }
  }

  const activeBackend = config?.backend ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[16px] font-semibold text-slate-900">Workspace backend</h2>
        <p className="text-[13px] text-slate-500 mt-1">
          Pick once — every agent at this client uses this backend. Changing backends requires a migration.
        </p>
      </div>

      {error && (
        <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Synthetos native card */}
        <div
          className={`p-5 border-2 rounded-xl cursor-pointer transition-colors ${
            selectedBackend === 'synthetos_native'
              ? 'border-indigo-500 bg-indigo-50'
              : 'border-slate-200 hover:border-slate-300 bg-white'
          }`}
          onClick={() => setSelectedBackend('synthetos_native')}
        >
          <div className="font-semibold text-[14px] text-slate-900 mb-1">Synthetos native</div>
          <p className="text-[13px] text-slate-500">Built-in email and calendar for agents. No external setup — demoable on day one.</p>
          <div className="mt-3 text-[12px] text-slate-400">
            <div>Email: <code className="text-[11px]">{'{name}'}@{activeBackend === 'synthetos_native' ? 'workspace.synthetos.io' : 'workspace.synthetos.io'}</code></div>
            <div className="mt-0.5 text-green-600 font-medium">Instant setup</div>
          </div>
          {activeBackend === 'synthetos_native' && (
            <div className="mt-3 text-[12px] text-green-700 font-medium">Connected</div>
          )}
          {selectedBackend === 'synthetos_native' && activeBackend !== 'synthetos_native' && (
            <button
              onClick={(e) => { e.stopPropagation(); handleConfigureNative(); }}
              disabled={configuring}
              className="mt-3 px-3 py-1.5 text-[12px] bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {configuring ? 'Configuring…' : 'Use Synthetos native'}
            </button>
          )}
        </div>

        {/* Google Workspace card */}
        <div
          className={`p-5 border-2 rounded-xl cursor-pointer transition-colors ${
            selectedBackend === 'google_workspace'
              ? 'border-indigo-500 bg-indigo-50'
              : 'border-slate-200 hover:border-slate-300 bg-white'
          }`}
          onClick={() => setSelectedBackend('google_workspace')}
        >
          <div className="font-semibold text-[14px] text-slate-900 mb-1">Google Workspace</div>
          <p className="text-[13px] text-slate-500">Real Workspace users on the client's domain. Requires service-account + domain-wide delegation.</p>
          <div className="mt-3 text-[12px] text-slate-400">
            <div>Email: <code className="text-[11px]">{'{name}'}@clientdomain.com</code></div>
            <div className="mt-0.5">Setup: ~5 min admin work</div>
          </div>
          {activeBackend === 'google_workspace' && (
            <div className="mt-3 text-[12px] text-green-700 font-medium">Connected</div>
          )}
          {selectedBackend === 'google_workspace' && activeBackend !== 'google_workspace' && !showGoogleForm && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowGoogleForm(true); }}
              className="mt-3 px-3 py-1.5 text-[12px] bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Configure Google Workspace
            </button>
          )}
        </div>
      </div>

      {/* Google Workspace configuration form */}
      {selectedBackend === 'google_workspace' && showGoogleForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-[14px] font-semibold text-slate-900">Google Workspace setup</h3>
          <p className="text-[13px] text-slate-500">
            Ensure your service account JSON key (<code>GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON</code>) and admin delegated user
            (<code>GOOGLE_WORKSPACE_ADMIN_DELEGATED_USER</code>) are set in your environment before connecting.
          </p>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">Customer domain</label>
            <input
              className="w-full max-w-xs px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="clientco.com"
              value={googleDomain}
              onChange={e => setGoogleDomain(e.target.value)}
            />
            <p className="text-[12px] text-slate-400 mt-1">The primary Google Workspace domain for this client.</p>
          </div>
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-[12px]">
            {[
              'Admin SDK Directory — user read/write (provisioning, suspend)',
              'Gmail API — send / read on behalf of agent identity',
              'Google Calendar — create / read events on behalf of agent',
            ].map((scope) => (
              <div key={scope} className="px-3 py-2 flex items-center gap-2 text-slate-600">
                <span className="text-slate-400">›</span>{scope}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleConfigureGoogle}
              disabled={configuring || !googleDomain.trim()}
              className="px-4 py-2 text-[13px] bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {configuring ? 'Connecting…' : 'Connect Google Workspace'}
            </button>
            <button
              onClick={() => { setShowGoogleForm(false); }}
              className="px-4 py-2 text-[13px] text-slate-600 hover:bg-slate-100 rounded"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {activeBackend && (
        <div className="flex justify-end">
          <button
            onClick={() => setMigrateOpen(true)}
            className="px-4 py-2 text-[13px] border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50"
          >
            Migrate to {activeBackend === 'synthetos_native' ? 'Google Workspace' : 'Synthetos native'}…
          </button>
        </div>
      )}

      <SeatsPanel subaccountId={subaccountId} />

      {migrateOpen && config && activeBackend && (
        <MigrateWorkspaceModal
          subaccountId={subaccountId}
          currentBackend={activeBackend as 'synthetos_native' | 'google_workspace'}
          targetBackend={activeBackend === 'synthetos_native' ? 'google_workspace' : 'synthetos_native'}
          onClose={() => setMigrateOpen(false)}
        />
      )}
    </div>
  );
}
