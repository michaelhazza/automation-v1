import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import Modal from './Modal';

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
  user: { id: string; role: string };
  subaccountId?: string; // undefined = org-level scope
}

export default function CredentialsTab({ subaccountId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Web login modal
  const [webLoginModal, setWebLoginModal] = useState<{ conn: Connection | null } | null>(null);
  const [webLoginForm, setWebLoginForm] = useState({ label: '', loginUrl: '', username: '', password: '' });
  const [webLoginSaving, setWebLoginSaving] = useState(false);

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

  // Detect ?connected=slack after OAuth redirect
  useEffect(() => {
    const connected = searchParams.get('connected');
    const oauthError = searchParams.get('error');
    if (connected === 'slack') {
      setSearchParams(p => { p.delete('connected'); return p; }, { replace: true });
      load({ openSlackConfig: true });
    } else if (oauthError) {
      setError(`Connection failed: ${oauthError.replace(/_/g, ' ')}`);
      setSearchParams(p => { p.delete('error'); return p; }, { replace: true });
      load();
    } else {
      load();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [slackConfigConn?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const connectSlack = async () => {
    try {
      const returnPath = window.location.pathname + window.location.search;
      const separator = returnPath.includes('?') ? '&' : '?';
      const oauthParams: Record<string, string> = {
        provider: 'slack',
        scope: subaccountId ? 'subaccount' : 'org',
        returnPath: encodeURIComponent(`${returnPath}${separator}connected=slack`),
      };
      if (subaccountId) oauthParams.subaccountId = subaccountId;
      const { data } = await api.get('/api/integrations/oauth2/auth-url', { params: oauthParams });
      window.location.href = (data as { url: string }).url;
    } catch {
      setError('Failed to initiate Slack connection. Check that OAUTH_SLACK_CLIENT_ID is configured.');
    }
  };

  const saveSlackChannel = async () => {
    if (!slackConfigConn) return;
    setSavingChannel(true);
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
    try {
      const url = subaccountId
        ? `/api/subaccounts/${subaccountId}/connections/${conn.id}`
        : `/api/org/connections/${conn.id}`;
      await api.delete(url);
      load();
    } catch {
      setError('Failed to revoke connection');
    }
  };

  const openAddWebLogin = () => {
    setWebLoginForm({ label: '', loginUrl: '', username: '', password: '' });
    setWebLoginModal({ conn: null });
  };

  const openEditWebLogin = (conn: Connection) => {
    const cfg = webLoginConfig(conn);
    setWebLoginForm({ label: conn.label ?? '', loginUrl: cfg.loginUrl ?? '', username: cfg.username ?? '', password: '' });
    setWebLoginModal({ conn });
  };

  const saveWebLogin = async () => {
    setWebLoginSaving(true);
    try {
      const payload = {
        label: webLoginForm.label || undefined,
        loginUrl: webLoginForm.loginUrl,
        username: webLoginForm.username,
        password: webLoginForm.password || undefined,
      };
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
  const hasSlack = oauthProviders.some(c => c.providerType === 'slack' && c.connectionStatus === 'active');

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
          {!hasSlack && (
            <button
              onClick={connectSlack}
              className="text-sm px-3 py-1.5 rounded-md bg-[#4A154B] text-white hover:bg-[#611f69] transition-colors"
            >
              Connect Slack
            </button>
          )}
        </div>

        {oauthProviders.length === 0 ? (
          <p className="text-sm text-slate-500">No OAuth connections yet. Connect Slack to enable agent messaging.</p>
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
                    className="text-xs text-red-400 hover:text-red-700"
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
            className="text-sm px-3 py-1.5 rounded-md bg-slate-800 text-white hover:bg-slate-700 transition-colors"
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
                    <button
                      onClick={() => openEditWebLogin(conn)}
                      className="text-xs text-slate-500 hover:text-slate-800 underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => revokeConnection(conn)}
                      className="text-xs text-red-400 hover:text-red-700"
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
            <button onClick={() => setSlackConfigConn(null)} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
            <button
              onClick={saveSlackChannel}
              disabled={savingChannel}
              className="px-3 py-1.5 text-sm bg-slate-800 text-white rounded-md hover:bg-slate-700 disabled:opacity-50"
            >
              {savingChannel ? 'Saving…' : 'Save'}
            </button>
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
              <button onClick={() => setWebLoginModal(null)} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
              <button
                onClick={saveWebLogin}
                disabled={webLoginSaving || !webLoginForm.loginUrl || !webLoginForm.username || (!webLoginModal.conn && !webLoginForm.password)}
                className="px-3 py-1.5 text-sm bg-slate-800 text-white rounded-md hover:bg-slate-700 disabled:opacity-50"
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
