import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import McpCatalogue from '../components/McpCatalogue';
import McpToolBrowser from '../components/McpToolBrowser';

interface McpServer {
  id: string;
  presetSlug: string | null;
  name: string;
  slug: string;
  description: string | null;
  transport: string;
  defaultGateLevel: string;
  status: string;
  lastConnectedAt: string | null;
  lastError: string | null;
  discoveredToolsJson: Array<{ name: string; description?: string }> | null;
  rejectedToolCount: number | null;
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
  createdAt: string;
}

interface ConnectorConfig {
  id: string;
  connectorType: string;
  enabled: boolean;
  status: string;
  pollingIntervalMinutes: number | null;
  lastSyncAt: string | null;
  syncStatus: string | null;
  createdAt: string;
}

// Unified integration item for the Active tab
interface IntegrationItem {
  id: string;
  name: string;
  type: 'mcp_server' | 'native_connector';
  status: string;
  description: string | null;
  toolCount: number;
  lastActivity: string | null;
  raw: McpServer | ConnectorConfig;
}

const CONNECTOR_LABELS: Record<string, string> = {
  ghl: 'GoHighLevel',
  stripe: 'Stripe',
  teamwork: 'Teamwork',
  slack: 'Slack',
};

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  disabled: 'bg-slate-100 text-slate-600',
  error: 'bg-red-100 text-red-800',
};

const GATE_LABELS: Record<string, string> = {
  auto: 'Auto',
  review: 'Review',
  block: 'Block',
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 60_000) return 'Just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

type ActiveTab = 'servers' | 'catalogue';

interface User { id: string; role: string; organisationId?: string }

export default function McpServersPage({ user: _user, subaccountId, embedded = false }: { user: User; subaccountId?: string; embedded?: boolean }) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [connectors, setConnectors] = useState<ConnectorConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ActiveTab>('servers');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteType, setDeleteType] = useState<'mcp' | 'connector'>('mcp');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ serverId: string; success: boolean; toolCount: number; tools: Array<{ name: string; description?: string }>; error?: string } | null>(null);
  const [editServer, setEditServer] = useState<McpServer | null>(null);
  const [editForm, setEditForm] = useState({ defaultGateLevel: 'auto', status: 'active' });
  const [editError, setEditError] = useState('');
  const [toolBrowserServer, setToolBrowserServer] = useState<McpServer | null>(null);

  const load = useCallback(async () => {
    try {
      const mcpUrl = subaccountId ? `/api/subaccounts/${subaccountId}/mcp-servers` : '/api/mcp-servers';
      const connectorUrl = subaccountId ? `/api/subaccounts/${subaccountId}/connectors` : '/api/org/connectors';
      const [mcpRes, connectorRes] = await Promise.all([
        api.get(mcpUrl),
        api.get(connectorUrl).catch(() => ({ data: [] })),
      ]);
      setServers(mcpRes.data);
      setConnectors(connectorRes.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [subaccountId]);

  // Build unified integration list
  const integrations: IntegrationItem[] = [
    ...servers.map((s): IntegrationItem => ({
      id: s.id,
      name: s.name,
      type: 'mcp_server',
      status: s.status,
      description: s.description,
      toolCount: s.discoveredToolsJson?.length ?? 0,
      lastActivity: s.lastConnectedAt,
      raw: s,
    })),
    ...connectors.map((c): IntegrationItem => ({
      id: c.id,
      name: CONNECTOR_LABELS[c.connectorType] ?? c.connectorType,
      type: 'native_connector',
      status: c.status ?? (c.enabled ? 'active' : 'disabled'),
      description: `Data connector · Polls every ${c.pollingIntervalMinutes ?? 60}m`,
      toolCount: 0,
      lastActivity: c.lastSyncAt,
      raw: c,
    })),
  ];

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (deleteType === 'connector') {
      const url = subaccountId ? `/api/subaccounts/${subaccountId}/connectors/${id}` : `/api/org/connectors/${id}`;
      await api.delete(url);
    } else {
      const url = subaccountId ? `/api/subaccounts/${subaccountId}/mcp-servers/${id}` : `/api/mcp-servers/${id}`;
      await api.delete(url);
    }
    setDeleteId(null);
    load();
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const { data } = await api.post(`/api/mcp-servers/${id}/test`);
      setTestResult({ serverId: id, ...data });
    } catch {
      setTestResult({ serverId: id, success: false, toolCount: 0, tools: [], error: 'Test request failed' });
    } finally {
      setTestingId(null);
    }
  };

  const handleEdit = (server: McpServer) => {
    setEditServer(server);
    setEditForm({ defaultGateLevel: server.defaultGateLevel, status: server.status });
    setEditError('');
  };

  const handleEditSave = async () => {
    if (!editServer) return;
    try {
      await api.patch(`/api/mcp-servers/${editServer.id}`, editForm);
      setEditServer(null);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setEditError(e.response?.data?.message ?? 'Failed to save');
    }
  };

  const handleAdded = () => {
    setTab('servers');
    load();
  };

  const inputCls = 'block w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

  if (loading) {
    return <div className="py-20 text-center text-sm text-slate-400">Loading...</div>;
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      {!embedded && (
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-[28px] font-bold text-slate-800 m-0">Integrations</h1>
            <p className="text-sm text-slate-500 mt-2 max-w-lg leading-relaxed">
              Connect external tools and data sources to expand agent capabilities. Browse the catalogue to add integrations.
            </p>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-6 w-fit">
        {([['servers', `Active (${integrations.length})`], ['catalogue', 'Catalogue']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key as ActiveTab)}
            className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors border-0 cursor-pointer ${
              tab === key ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'catalogue' && (
        <McpCatalogue onAdded={handleAdded} subaccountId={subaccountId} />
      )}

      {tab === 'servers' && (
        <>
          {integrations.length === 0 ? (
            <div className="py-16 px-8 flex flex-col items-center text-center bg-white border border-slate-200 rounded-xl">
              <div className="text-[15px] font-semibold text-slate-800 mb-1.5">No integrations configured yet</div>
              <p className="text-sm text-slate-500 mb-4">Browse the catalogue to add your first integration.</p>
              <button
                onClick={() => setTab('catalogue')}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Browse Catalogue
              </button>
            </div>
          ) : (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
              {integrations.map((item) => {
                const isMcp = item.type === 'mcp_server';
                const server = isMcp ? item.raw as McpServer : null;
                const connector = !isMcp ? item.raw as ConnectorConfig : null;
                const isCircuitOpen = server?.circuitOpenUntil && new Date(server.circuitOpenUntil) > new Date();

                return (
                  <div key={`${item.type}-${item.id}`} className="bg-white border border-slate-200 rounded-xl p-5">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${item.status === 'active' ? 'bg-green-500' : item.status === 'error' ? 'bg-red-500' : 'bg-slate-400'}`} />
                        <div className="font-bold text-[16px] text-slate-800">{item.name}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${isMcp ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>
                          {isMcp ? 'Tools' : 'Data Sync'}
                        </span>
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[12px] font-semibold capitalize ${STATUS_STYLES[item.status] ?? STATUS_STYLES.disabled}`}>
                          {item.status}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1 mb-3 text-[13px] text-slate-500">
                      {isMcp && server && (
                        <>
                          <div>{server.transport} · {item.toolCount} tools</div>
                          <div>Gate: {GATE_LABELS[server.defaultGateLevel] ?? server.defaultGateLevel}</div>
                          <div>Connected: {timeAgo(server.lastConnectedAt)}</div>
                          {isCircuitOpen && (
                            <div className="text-orange-600 font-medium">Circuit open — retrying {timeAgo(server.circuitOpenUntil)}</div>
                          )}
                          {server.lastError && server.status === 'error' && (
                            <div className="text-red-500 text-[12px] truncate">{server.lastError}</div>
                          )}
                        </>
                      )}
                      {!isMcp && connector && (
                        <>
                          <div>Polls every {connector.pollingIntervalMinutes ?? 60} minutes</div>
                          {connector.lastSyncAt && <div>Last sync: {timeAgo(connector.lastSyncAt)}</div>}
                          {connector.syncStatus && (
                            <div className={connector.syncStatus === 'error' ? 'text-red-500' : 'text-green-600'}>
                              Sync: {connector.syncStatus}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <div className="flex gap-2 pt-2 border-t border-slate-100">
                      {isMcp && server && (
                        <>
                          <button
                            onClick={() => handleTest(server.id)}
                            disabled={testingId === server.id}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium transition-colors border-0 cursor-pointer disabled:opacity-50"
                          >
                            {testingId === server.id ? 'Testing...' : 'Test'}
                          </button>
                          {item.toolCount > 0 && (
                            <button
                              onClick={() => setToolBrowserServer(server)}
                              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium transition-colors border-0 cursor-pointer"
                            >
                              Tools
                            </button>
                          )}
                          <button
                            onClick={() => handleEdit(server)}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium transition-colors border-0 cursor-pointer"
                          >
                            Edit
                          </button>
                        </>
                      )}
                      {!isMcp && connector && (
                        <button
                          onClick={async () => { try { const syncUrl = subaccountId ? `/api/subaccounts/${subaccountId}/connectors/${connector.id}/sync` : `/api/org/connectors/${connector.id}/sync`; await api.post(syncUrl); load(); } catch {} }}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium transition-colors border-0 cursor-pointer"
                        >
                          Sync Now
                        </button>
                      )}
                      <button
                        onClick={() => { setDeleteId(item.id); setDeleteType(isMcp ? 'mcp' : 'connector'); }}
                        className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-md text-xs font-medium transition-colors border-0 cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>

                    {/* Test result inline (MCP only) */}
                    {isMcp && testResult?.serverId === item.id && (
                      <div className={`mt-3 p-3 rounded-lg text-[12px] ${testResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                        {testResult.success
                          ? `Connected — discovered ${testResult.toolCount} tools`
                          : `Failed: ${testResult.error}`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <ConfirmDialog
          title="Delete Integration"
          message={`Delete "${integrations.find(i => i.id === deleteId)?.name}"? This will remove the configuration. Agents will lose access to this integration on their next run.`}
          confirmLabel="Delete"
          onConfirm={() => handleDelete(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}

      {/* Edit modal */}
      {editServer && (
        <Modal title={`${editServer.name} Settings`} onClose={() => setEditServer(null)} maxWidth={440}>
          {editError && <div className="mb-4 p-3 bg-red-50 text-red-700 text-[13px] rounded-lg">{editError}</div>}

          <label className="block text-[13px] font-semibold text-slate-700 mb-4">
            Default Gate Level
            <select
              value={editForm.defaultGateLevel}
              onChange={(e) => setEditForm({ ...editForm, defaultGateLevel: e.target.value })}
              className={inputCls}
            >
              <option value="auto">Auto — execute immediately</option>
              <option value="review">Review — require human approval</option>
              <option value="block">Block — deny all tool calls</option>
            </select>
          </label>

          <label className="block text-[13px] font-semibold text-slate-700 mb-6">
            Status
            <select
              value={editForm.status}
              onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
              className={inputCls}
            >
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>

          <div className="flex gap-2.5 justify-end">
            <button onClick={() => setEditServer(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[13px] font-semibold border-0 cursor-pointer transition-colors">Cancel</button>
            <button onClick={handleEditSave} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[13px] font-semibold border-0 cursor-pointer transition-colors">Save Changes</button>
          </div>
        </Modal>
      )}

      {/* Tool browser modal */}
      {toolBrowserServer && (
        <McpToolBrowser
          server={toolBrowserServer}
          onClose={() => setToolBrowserServer(null)}
        />
      )}
    </div>
  );
}
