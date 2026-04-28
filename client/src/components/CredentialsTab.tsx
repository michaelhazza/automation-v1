import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import Modal from './Modal';

interface SubaccountAgentOption {
  id: string;
  agentId: string;
  name: string;
}

interface Connection {
  id: string;
  providerType: string;
  authType: string;
  label: string | null;
  displayName: string | null;
  connectionStatus: string;
  configJson: Record<string, unknown> | null;
  hasAccessToken: boolean;
  createdAt: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  slack: 'Slack',
  gmail: 'Gmail',
  github: 'GitHub',
  hubspot: 'HubSpot',
  ghl: 'GoHighLevel',
  teamwork: 'Teamwork',
  web_login: 'Web Login',
  custom: 'Custom',
};

/** OAuth providers available for connection — matches server/config/oauthProviders.ts */
const OAUTH_PROVIDER_OPTIONS: { key: string; label: string; description: string }[] = [
  { key: 'slack', label: 'Slack', description: 'Team messaging and notifications' },
  { key: 'gmail', label: 'Gmail', description: 'Send and read emails' },
  { key: 'hubspot', label: 'HubSpot', description: 'CRM contacts and deals' },
  { key: 'ghl', label: 'GoHighLevel', description: 'Contacts and opportunities' },
  { key: 'teamwork', label: 'Teamwork', description: 'Project management' },
];

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  expired: 'bg-yellow-100 text-yellow-800',
  revoked: 'bg-red-100 text-red-800',
  error: 'bg-red-100 text-red-800',
};

function slackChannel(conn: Connection): string | null {
  return (conn.configJson?.defaultChannel as string) ?? null;
}

function webLoginConfig(conn: Connection): { loginUrl?: string; username?: string } {
  return (conn.configJson ?? {}) as { loginUrl?: string; username?: string };
}

interface Props {
  subaccountId?: string; // undefined = org-level scope
}

export default function CredentialsTab({ subaccountId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Web login modal
  const [webLoginModal, setWebLoginModal] = useState<{ conn: Connection | null } | null>(null);
  const [webLoginForm, setWebLoginForm] = useState({ label: '', loginUrl: '', username: '', password: '' });
  const [webLoginSaving, setWebLoginSaving] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Web login test modal (IEE Phase 0 — audit blocker #1).
  // Firing a test requires picking an agent to attribute the test run to.
  // The run goes through the same delegated-lifecycle plumbing as any other
  // IEE browser task, so the user can watch it progress in the agent-run
  // detail view.
  const [testModal, setTestModal] = useState<{ conn: Connection } | null>(null);
  const [testAgents, setTestAgents] = useState<SubaccountAgentOption[]>([]);
  const [testAgentsLoading, setTestAgentsLoading] = useState(false);
  const [selectedTestAgentId, setSelectedTestAgentId] = useState<string>('');
  const [testFiring, setTestFiring] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  // Provider dropdown
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const providerMenuRef = useRef<HTMLDivElement>(null);

  // Slack channel config modal
  const [slackConfigConn, setSlackConfigConn] = useState<Connection | null>(null);
  const [slackChannels, setSlackChannels] = useState<{ id: string; name: string }[]>([]);
  const [defaultChannel, setDefaultChannel] = useState('');
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);

  const baseUrl = subaccountId
    ? `/api/subaccounts/${subaccountId}`
    : '/api/org';

  const load = useCallback(async (options?: { openSlackConfig?: boolean }) => {
    setLoading(true);
    try {
      const { data } = await api.get(`${baseUrl}/connections`);
      const visible = (data as Connection[]).filter(c => c.connectionStatus !== 'revoked');
      setConnections(visible);
      if (options?.openSlackConfig) {
        const newSlack = visible.find(c => c.providerType === 'slack' && c.connectionStatus === 'active');
        if (newSlack) {
          setSlackConfigConn(newSlack);
          setDefaultChannel(slackChannel(newSlack) ?? '');
        }
      }
    } catch {
      setError('Failed to load connections');
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  // Detect ?connected=<provider> after OAuth redirect
  useEffect(() => {
    const connected = searchParams.get('connected');
    const oauthError = searchParams.get('error');
    if (connected) {
      setSearchParams(p => { p.delete('connected'); return p; }, { replace: true });
      load({ openSlackConfig: connected === 'slack' });
    } else if (oauthError) {
      setError(`Connection failed: ${oauthError.replace(/_/g, ' ')}`);
      setSearchParams(p => { p.delete('error'); return p; }, { replace: true });
      load();
    } else {
      load();
    }
  // On mount only — `load` is stable for the component's lifetime since subaccountId
  // doesn't change after mount. Intentionally not re-running on load reference changes.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close provider menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (providerMenuRef.current && !providerMenuRef.current.contains(e.target as Node)) {
        setShowProviderMenu(false);
      }
    }
    if (showProviderMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showProviderMenu]);

  // Fetch Slack channels when modal opens
  useEffect(() => {
    if (!slackConfigConn) return;
    setChannelsLoading(true);
    setSlackChannels([]);
    const url = subaccountId
      ? `/api/subaccounts/${subaccountId}/connections/${slackConfigConn.id}/slack-channels`
      : `/api/org/connections/${slackConfigConn.id}/slack-channels`;
    api.get(url)
      .then(r => setSlackChannels(r.data as { id: string; name: string }[]))
      .catch(() => setSlackChannels([]))
      .finally(() => setChannelsLoading(false));
  }, [slackConfigConn?.id, subaccountId]);

  const connectProvider = async (provider: string) => {
    setError(null);
    setShowProviderMenu(false);
    try {
      // Strip OAuth callback params from current URL to prevent redirect loop
      const cleanParams = new URLSearchParams(window.location.search);
      cleanParams.delete('connected');
      cleanParams.delete('error');
      const cleanSearch = cleanParams.toString() ? `?${cleanParams.toString()}` : '';
      const cleanPath = window.location.pathname + cleanSearch;
      const separator = cleanSearch.includes('?') ? '&' : '?';
      const oauthParams: Record<string, string> = {
        provider,
        scope: subaccountId ? 'subaccount' : 'org',
        returnPath: encodeURIComponent(`${cleanPath}${separator}connected=${provider}`),
      };
      if (subaccountId) oauthParams.subaccountId = subaccountId;
      const { data } = await api.get('/api/integrations/oauth2/auth-url', { params: oauthParams });
      window.location.href = (data as { url: string }).url;
    } catch {
      const label = PROVIDER_LABELS[provider] ?? provider;
      setError(`Failed to initiate ${label} connection. Check that OAUTH_${provider.toUpperCase()}_CLIENT_ID is configured.`);
    }
  };

  const saveSlackChannel = async () => {
    if (!slackConfigConn) return;
    setSavingChannel(true);
    setError(null);
    try {
      const url = subaccountId
        ? `/api/subaccounts/${subaccountId}/connections/${slackConfigConn.id}`
        : `/api/org/connections/${slackConfigConn.id}`;
      await api.patch(url, { configJson: { ...slackConfigConn.configJson, defaultChannel } });
      setSlackConfigConn(null);
      load();
    } catch {
      setError('Failed to save default channel');
    } finally {
      setSavingChannel(false);
    }
  };

  const revokeConnection = async (conn: Connection) => {
    if (!confirm(`Revoke ${PROVIDER_LABELS[conn.providerType] ?? conn.providerType} connection?`)) return;
    setRevokingId(conn.id);
    setError(null);
    try {
      const url = subaccountId
        ? `/api/subaccounts/${subaccountId}/connections/${conn.id}`
        : `/api/org/connections/${conn.id}`;
      await api.delete(url);
      load();
    } catch {
      setError('Failed to revoke connection');
    } finally {
      setRevokingId(null);
    }
  };

  const openAddWebLogin = () => {
    setError(null);
    setWebLoginForm({ label: '', loginUrl: '', username: '', password: '' });
    setWebLoginModal({ conn: null });
  };

  const openEditWebLogin = (conn: Connection) => {
    setError(null);
    const cfg = webLoginConfig(conn);
    setWebLoginForm({ label: conn.label ?? '', loginUrl: cfg.loginUrl ?? '', username: cfg.username ?? '', password: '' });
    setWebLoginModal({ conn });
  };

  // IEE Phase 0 — open the test-connection modal and load the subaccount's
  // agent list. The test fires a login_test IEE task against the saved
  // credential, attributed to the chosen agent.
  const openTestConnection = async (conn: Connection) => {
    if (!subaccountId) return; // test is subaccount-scoped only
    setTestError(null);
    setSelectedTestAgentId('');
    setTestModal({ conn });
    setTestAgentsLoading(true);
    try {
      // Codex iteration-3 finding P2: use the narrow test-eligible-agents
      // endpoint (gated on CONNECTIONS_MANAGE + AGENTS_EDIT) instead of the
      // broader /agents route (gated on org-level SUBACCOUNTS_VIEW). Portal
      // users with only subaccount-level permissions can now load this list.
      const { data } = await api.get(
        `/api/subaccounts/${subaccountId}/web-login-connections/test-eligible-agents`,
      );
      const rows: SubaccountAgentOption[] = (Array.isArray(data) ? data : []).map((row: {
        id: string;
        agentId: string;
        name?: string;
      }) => ({
        id: row.id,
        agentId: row.agentId,
        name: row.name ?? 'Unnamed agent',
      }));
      setTestAgents(rows);
      if (rows.length === 1) setSelectedTestAgentId(rows[0].id);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Failed to load agents';
      setTestError(msg);
    } finally {
      setTestAgentsLoading(false);
    }
  };

  const fireTestConnection = async () => {
    if (!subaccountId || !testModal) return;
    const agent = testAgents.find((a) => a.id === selectedTestAgentId);
    if (!agent) {
      setTestError('Select an agent to attribute the test run to.');
      return;
    }
    setTestFiring(true);
    setTestError(null);
    try {
      const { data } = await api.post(
        `/api/subaccounts/${subaccountId}/web-login-connections/${testModal.conn.id}/test`,
        {
          agentId: agent.agentId,
          subaccountAgentId: agent.id,
        },
      );
      setTestModal(null);
      // Navigate to the run detail page — the delegated lifecycle +
      // progress polling there gives the user live feedback on the test.
      navigate(`/admin/subaccounts/${subaccountId}/runs/${data.agentRunId}`);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string; message?: string } } }).response?.data?.error
        ?? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        ?? 'Failed to start test';
      setTestError(msg);
    } finally {
      setTestFiring(false);
    }
  };

  const saveWebLogin = async () => {
    setWebLoginSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        config: {
          loginUrl: webLoginForm.loginUrl,
          username: webLoginForm.username,
        },
      };
      if (webLoginForm.label) payload.label = webLoginForm.label;
      if (webLoginForm.password) payload.password = webLoginForm.password;
      const webLoginBase = subaccountId
        ? `/api/subaccounts/${subaccountId}/web-login-connections`
        : '/api/org/web-login-connections';
      if (webLoginModal?.conn) {
        await api.patch(`${webLoginBase}/${webLoginModal.conn.id}`, payload);
      } else {
        await api.post(webLoginBase, payload);
      }
      setWebLoginModal(null);
      load();
    } catch {
      setError('Failed to save web login');
    } finally {
      setWebLoginSaving(false);
    }
  };

  const oauthProviders = connections.filter(c => c.providerType !== 'web_login');
  const webLogins = connections.filter(c => c.providerType === 'web_login');

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading credentials…</div>;

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="ml-4 text-red-500 hover:text-red-700">✕</button>
        </div>
      )}

      {/* OAuth Connections */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700">OAuth Connections</h2>
          <div className="relative" ref={providerMenuRef}>
            <button
              onClick={() => setShowProviderMenu(v => !v)}
              className="btn btn-sm btn-primary"
            >
              + Add Connection
            </button>
            {showProviderMenu && (
              <div className="absolute right-0 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1">
                {OAUTH_PROVIDER_OPTIONS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => connectProvider(p.key)}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors"
                  >
                    <span className="text-sm font-medium text-slate-800">{p.label}</span>
                    <span className="block text-xs text-slate-400">{p.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {oauthProviders.length === 0 ? (
          <p className="text-sm text-slate-500">No OAuth connections yet. Add a connection to enable agent integrations.</p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {oauthProviders.map(conn => (
              <div key={conn.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="text-sm font-medium text-slate-800">
                    {conn.displayName ?? PROVIDER_LABELS[conn.providerType] ?? conn.providerType}
                  </span>
                  {conn.label && <span className="ml-2 text-xs text-slate-400">{conn.label}</span>}
                  {conn.providerType === 'slack' && slackChannel(conn) && (
                    <span className="ml-2 text-xs text-slate-500">→ #{slackChannel(conn)}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[conn.connectionStatus] ?? 'bg-slate-100 text-slate-600'}`}>
                    {conn.connectionStatus}
                  </span>
                  {conn.providerType === 'slack' && (
                    <button
                      onClick={() => { setSlackConfigConn(conn); setDefaultChannel(slackChannel(conn) ?? ''); }}
                      className="text-xs text-slate-500 hover:text-slate-800 underline"
                    >
                      Configure
                    </button>
                  )}
                  <button
                    onClick={() => revokeConnection(conn)}
                    disabled={revokingId === conn.id}
                    className="text-xs text-red-400 hover:text-red-700 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Web Login Credentials */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Web Login Credentials</h2>
            <p className="text-xs text-slate-400 mt-0.5">Stored logins agents use to access paywalled content (e.g. 42macro.com)</p>
          </div>
          <button
            onClick={openAddWebLogin}
            className="btn btn-sm btn-primary"
          >
            + Add Login
          </button>
        </div>

        {webLogins.length === 0 ? (
          <p className="text-sm text-slate-500">No web login credentials saved.</p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {webLogins.map(conn => {
              const cfg = webLoginConfig(conn);
              return (
                <div key={conn.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <span className="text-sm font-medium text-slate-800">{conn.label ?? cfg.loginUrl ?? 'Web Login'}</span>
                    {cfg.username && <span className="ml-2 text-xs text-slate-400">{cfg.username}</span>}
                    {cfg.loginUrl && <span className="ml-2 text-xs text-slate-400 truncate max-w-xs">{cfg.loginUrl}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Test button is subaccount-scoped only. The endpoint
                        requires a subaccountAgentId, which org-scope callers
                        can't provide without picking a subaccount first. */}
                    {subaccountId && (
                      <button
                        onClick={() => openTestConnection(conn)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 underline"
                      >
                        Test
                      </button>
                    )}
                    <button
                      onClick={() => openEditWebLogin(conn)}
                      className="text-xs text-slate-500 hover:text-slate-800 underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => revokeConnection(conn)}
                      disabled={revokingId === conn.id}
                      className="text-xs text-red-400 hover:text-red-700 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Slack default channel modal */}
      {slackConfigConn && (
        <Modal title="Configure Slack" onClose={() => setSlackConfigConn(null)}>
          <p className="text-sm text-slate-600 mb-4">Choose the default channel agents will post to when no channel is specified.</p>
          {channelsLoading ? (
            <p className="text-sm text-slate-400 mb-4">Loading channels…</p>
          ) : slackChannels.length > 0 ? (
            <select
              value={defaultChannel}
              onChange={e => setDefaultChannel(e.target.value)}
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm mb-4"
            >
              <option value="">— No default —</option>
              {slackChannels.map(ch => (
                <option key={ch.id} value={ch.name}>#{ch.name}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              placeholder="e.g. general"
              value={defaultChannel}
              onChange={e => setDefaultChannel(e.target.value)}
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm mb-4"
            />
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setSlackConfigConn(null)} className="btn btn-sm btn-ghost">Cancel</button>
            <button
              onClick={saveSlackChannel}
              disabled={savingChannel}
              className="btn btn-sm btn-primary"
            >
              {savingChannel ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {/* Test Web Login modal — IEE Phase 0 audit blocker #1 */}
      {testModal !== null && (
        <Modal
          title={`Test connection: ${testModal.conn.label ?? 'Web Login'}`}
          onClose={() => setTestModal(null)}
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Fires a browser task that logs in with this connection's credentials
              and verifies success. You can follow progress in the agent run
              detail page after starting the test.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Attribute run to agent
              </label>
              {testAgentsLoading ? (
                <div className="text-xs text-slate-400">Loading agents…</div>
              ) : testAgents.length === 0 ? (
                <div className="text-xs text-amber-600">
                  No agents available in this subaccount. Assign at least one agent before testing.
                </div>
              ) : (
                <select
                  value={selectedTestAgentId}
                  onChange={(e) => setSelectedTestAgentId(e.target.value)}
                  className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">Select an agent…</option>
                  {testAgents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
            </div>
            {testError && (
              <div className="text-xs text-red-600">{testError}</div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setTestModal(null)}
                className="btn btn-sm btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={fireTestConnection}
                disabled={testFiring || !selectedTestAgentId || testAgents.length === 0}
                className="btn btn-sm btn-primary"
              >
                {testFiring ? 'Starting…' : 'Start test'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Web login modal */}
      {webLoginModal !== null && (
        <Modal
          title={webLoginModal.conn ? 'Edit Web Login' : 'Add Web Login'}
          onClose={() => setWebLoginModal(null)}
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Label (optional)</label>
              <input
                type="text"
                placeholder="e.g. 42macro"
                value={webLoginForm.label}
                onChange={e => setWebLoginForm(f => ({ ...f, label: e.target.value }))}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Login URL</label>
              <input
                type="url"
                placeholder="https://example.com/login"
                value={webLoginForm.loginUrl}
                onChange={e => setWebLoginForm(f => ({ ...f, loginUrl: e.target.value }))}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Username / Email</label>
              <input
                type="text"
                value={webLoginForm.username}
                onChange={e => setWebLoginForm(f => ({ ...f, username: e.target.value }))}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Password {webLoginModal.conn && <span className="text-slate-400">(leave blank to keep existing)</span>}
              </label>
              <input
                type="password"
                value={webLoginForm.password}
                onChange={e => setWebLoginForm(f => ({ ...f, password: e.target.value }))}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setWebLoginModal(null)} className="btn btn-sm btn-ghost">Cancel</button>
              <button
                onClick={saveWebLogin}
                disabled={webLoginSaving || !webLoginForm.loginUrl || !webLoginForm.username || (!webLoginModal.conn && !webLoginForm.password)}
                className="btn btn-sm btn-primary"
              >
                {webLoginSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
