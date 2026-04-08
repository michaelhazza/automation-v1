import { useState, useEffect } from 'react';
import api from '../lib/api';
import Modal from './Modal';

interface McpPreset {
  slug: string;
  name: string;
  description: string;
  category: string;
  transport: string;
  integrationType: 'mcp_server' | 'native_connector';
  connectorType?: string;
  pollIntervalDefault?: number;
  requiresConnection: boolean;
  credentialProvider?: string;
  recommendedGateLevel: string;
  toolCount: number;
  toolHighlights: string[];
  setupNotes?: string;
  isAdded: boolean;
}

export default function McpCatalogue({ onAdded, subaccountId }: { onAdded: () => void; subaccountId?: string }) {
  const [presets, setPresets] = useState<McpPreset[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [addPreset, setAddPreset] = useState<McpPreset | null>(null);
  const [addForm, setAddForm] = useState({ defaultGateLevel: 'auto', envVars: '', pollIntervalMinutes: 60 });
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'not_connected' | null>(null);
  const [connectingOAuth, setConnectingOAuth] = useState(false);

  const presetsUrl = subaccountId
    ? `/api/subaccounts/${subaccountId}/mcp-presets`
    : '/api/mcp-presets';

  useEffect(() => {
    api.get(presetsUrl).then(({ data }) => {
      setPresets(data.presets);
      setCategories(data.categories);
    }).finally(() => setLoading(false));
  }, [presetsUrl]);

  const filtered = filter
    ? presets.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()) || p.description.toLowerCase().includes(filter.toLowerCase()))
    : presets;

  const grouped = Object.entries(categories).map(([key, label]) => ({
    key,
    label,
    presets: filtered.filter(p => p.category === key),
  })).filter(g => g.presets.length > 0);

  const handleAdd = async (preset: McpPreset) => {
    setAddPreset(preset);
    setAddForm({ defaultGateLevel: preset.recommendedGateLevel, envVars: '', pollIntervalMinutes: preset.pollIntervalDefault ?? 60 });
    setAddError('');

    // Check if OAuth connection exists for this provider
    if (preset.requiresConnection && preset.credentialProvider) {
      setConnectionStatus('checking');
      try {
        const connectionsUrl = subaccountId
          ? `/api/subaccounts/${subaccountId}/connections`
          : '/api/org/connections';
        const { data } = await api.get(connectionsUrl, { params: { provider: preset.credentialProvider } });
        const active = Array.isArray(data) && data.some((c: { connectionStatus: string }) => c.connectionStatus === 'active');
        setConnectionStatus(active ? 'connected' : 'not_connected');
      } catch {
        setConnectionStatus('not_connected');
      }
    } else {
      setConnectionStatus(null);
    }
  };

  const handleStartOAuth = async () => {
    if (!addPreset?.credentialProvider) return;
    setConnectingOAuth(true);
    try {
      const oauthParams: Record<string, string> = { provider: addPreset.credentialProvider!, scope: subaccountId ? 'subaccount' : 'org' };
      if (subaccountId) oauthParams.subaccountId = subaccountId;
      const { data } = await api.get('/api/integrations/oauth2/auth-url', {
        params: oauthParams,
      });
      // Open OAuth in new window — user completes flow then returns
      window.open(data.url, '_blank', 'width=600,height=700');
      // Poll for connection status
      const poll = setInterval(async () => {
        try {
          const pollConnectionsUrl = subaccountId
              ? `/api/subaccounts/${subaccountId}/connections`
              : '/api/org/connections';
            const { data: conns } = await api.get(pollConnectionsUrl, { params: { provider: addPreset.credentialProvider } });
          const active = Array.isArray(conns) && conns.some((c: { connectionStatus: string }) => c.connectionStatus === 'active');
          if (active) {
            setConnectionStatus('connected');
            setConnectingOAuth(false);
            clearInterval(poll);
          }
        } catch { /* keep polling */ }
      }, 2000);
      // Stop polling after 5 minutes
      setTimeout(() => { clearInterval(poll); setConnectingOAuth(false); }, 300_000);
    } catch {
      setAddError('Failed to start OAuth flow');
      setConnectingOAuth(false);
    }
  };

  const handleAddSubmit = async () => {
    if (!addPreset) return;
    setAdding(true);
    setAddError('');
    try {
      if (addPreset.integrationType === 'native_connector' && addPreset.connectorType) {
        // Create a native connector
        const connectorUrl = subaccountId
          ? `/api/subaccounts/${subaccountId}/connectors`
          : '/api/org/connectors';
        await api.post(connectorUrl, {
          connectorType: addPreset.connectorType,
          pollIntervalMinutes: addForm.pollIntervalMinutes,
        });
      } else {
        // Create an MCP server
        const mcpUrl = subaccountId
          ? `/api/subaccounts/${subaccountId}/mcp-servers`
          : '/api/mcp-servers';
        await api.post(mcpUrl, {
          presetSlug: addPreset.slug,
          defaultGateLevel: addForm.defaultGateLevel,
          envVars: addForm.envVars || undefined,
        });
      }
      setAddPreset(null);
      onAdded();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: string } } };
      setAddError(e.response?.data?.message ?? e.response?.data?.error ?? 'Failed to add integration');
    } finally {
      setAdding(false);
    }
  };

  const inputCls = 'block w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

  if (loading) return <div className="py-20 text-center text-sm text-slate-400">Loading catalogue...</div>;

  return (
    <div>
      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search integrations..."
          className="w-full max-w-sm px-4 py-2.5 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {grouped.length === 0 && (
        <div className="py-12 text-center text-[14px] text-slate-400">No integrations match your search.</div>
      )}

      {grouped.map(({ key, label, presets: groupPresets }) => (
        <div key={key} className="mb-8">
          <h2 className="text-[16px] font-bold text-slate-700 mb-3">{label}</h2>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {groupPresets.map((preset) => (
              <div key={preset.slug} className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <div className="font-bold text-[15px] text-slate-800">{preset.name}</div>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${preset.integrationType === 'native_connector' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                      {preset.integrationType === 'native_connector' ? 'Data Sync' : 'Tools'}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap">
                    {preset.integrationType === 'native_connector' ? `${preset.toolHighlights.length} capabilities` : `${preset.toolCount} tools`}
                  </span>
                </div>
                <p className="text-[13px] text-slate-500 leading-relaxed mb-3">{preset.description}</p>

                {/* Tool highlights */}
                <div className="flex flex-wrap gap-1 mb-3">
                  {preset.toolHighlights.slice(0, 4).map(t => (
                    <code key={t} className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{t}</code>
                  ))}
                  {preset.toolHighlights.length > 4 && (
                    <span className="text-[10px] text-slate-400">+{preset.toolHighlights.length - 4} more</span>
                  )}
                </div>

                {/* Credential requirement */}
                <div className="text-[12px] text-slate-400 mb-3">
                  {preset.requiresConnection
                    ? `Requires: ${preset.credentialProvider} connection`
                    : preset.setupNotes?.includes('API_KEY') ? 'Requires: API key in env' : 'No credentials needed'}
                </div>

                {preset.isAdded ? (
                  <span className="inline-block px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg text-[12px] font-medium">Already added</span>
                ) : (
                  <button
                    onClick={() => handleAdd(preset)}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[12px] font-semibold border-0 cursor-pointer transition-colors"
                  >
                    {subaccountId ? '+ Add to Company' : '+ Add to Org'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Add modal */}
      {addPreset && (
        <Modal title={`Add ${addPreset.name}`} onClose={() => setAddPreset(null)} maxWidth={480}>
          {addError && <div className="mb-4 p-3 bg-red-50 text-red-700 text-[13px] rounded-lg">{addError}</div>}

          <p className="text-[13px] text-slate-500 leading-relaxed mb-1">{addPreset.description}</p>
          <div className="flex flex-wrap gap-1 mb-4">
            {addPreset.toolHighlights.map(t => (
              <code key={t} className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{t}</code>
            ))}
          </div>

          {/* OAuth connection status */}
          {addPreset.requiresConnection && connectionStatus && (
            <div className={`mb-4 p-3 rounded-lg text-[13px] flex items-center justify-between ${connectionStatus === 'connected' ? 'bg-green-50 border border-green-100 text-green-800' : 'bg-amber-50 border border-amber-100 text-amber-800'}`}>
              {connectionStatus === 'checking' && <span>Checking connection...</span>}
              {connectionStatus === 'connected' && <span>{addPreset.credentialProvider} connected</span>}
              {connectionStatus === 'not_connected' && (
                <>
                  <span>No active {addPreset.credentialProvider} connection found</span>
                  <button
                    onClick={handleStartOAuth}
                    disabled={connectingOAuth}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[12px] font-semibold border-0 cursor-pointer transition-colors disabled:opacity-50 ml-3"
                  >
                    {connectingOAuth ? 'Connecting...' : `Connect ${addPreset.credentialProvider}`}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Setup notes (only show if no connection needed or already connected) */}
          {addPreset.setupNotes && (!addPreset.requiresConnection || connectionStatus !== 'not_connected') && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-[13px] text-blue-800 leading-relaxed">
              {addPreset.setupNotes}
            </div>
          )}

          {addPreset.integrationType === 'native_connector' ? (
            /* Native connector fields */
            <label className="block text-[13px] font-semibold text-slate-700 mb-6">
              Poll Interval (minutes)
              <input
                type="number"
                value={addForm.pollIntervalMinutes}
                onChange={(e) => setAddForm({ ...addForm, pollIntervalMinutes: parseInt(e.target.value) || 60 })}
                min={1}
                className={inputCls}
              />
              <span className="text-[11px] text-slate-400 mt-1 block">How often to sync data from this integration.</span>
            </label>
          ) : (
            /* MCP server fields */
            <>
              <label className="block text-[13px] font-semibold text-slate-700 mb-4">
                Environment Variables (optional, KEY=VALUE per line)
                <textarea
                  value={addForm.envVars}
                  onChange={(e) => setAddForm({ ...addForm, envVars: e.target.value })}
                  rows={3}
                  className={inputCls}
                  placeholder="BRAVE_API_KEY=your-key-here"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">Values are encrypted at rest. Only needed if the server requires config beyond OAuth.</span>
              </label>

              <label className="block text-[13px] font-semibold text-slate-700 mb-6">
                Default Gate Level
                <select
                  value={addForm.defaultGateLevel}
                  onChange={(e) => setAddForm({ ...addForm, defaultGateLevel: e.target.value })}
                  className={inputCls}
                >
                  <option value="auto">Auto — execute immediately</option>
                  <option value="review">Review — require human approval{addPreset.recommendedGateLevel === 'review' ? ' (recommended)' : ''}</option>
                  <option value="block">Block — deny all tool calls</option>
                </select>
              </label>
            </>
          )}

          <div className="flex gap-2.5 justify-end">
            <button onClick={() => setAddPreset(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[13px] font-semibold border-0 cursor-pointer transition-colors">Cancel</button>
            <button
              onClick={handleAddSubmit}
              disabled={adding}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[13px] font-semibold border-0 cursor-pointer transition-colors disabled:opacity-50"
            >
              {adding ? 'Adding...' : 'Add Integration'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
