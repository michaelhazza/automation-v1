import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Connection {
  id: string;
  providerType: string;
  authType: string;
  connectionStatus: 'active' | 'error' | 'revoked';
  label: string | null;
  displayName: string | null;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  hasSecretsRef: boolean;
  configJson: Record<string, unknown> | null;
  tokenExpiresAt: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CLS: Record<string, string> = {
  active: 'text-green-600',
  error: 'text-amber-600',
  revoked: 'text-red-600',
};

const STATUS_BG: Record<string, string> = {
  active: 'bg-green-50',
  error: 'bg-amber-50',
  revoked: 'bg-red-50',
};

const PROVIDER_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  github: 'GitHub',
  hubspot: 'HubSpot',
  slack: 'Slack',
  ghl: 'GoHighLevel',
  web_login: 'Web Login',
  teamwork: 'Teamwork',
  custom: 'Custom',
};

const inputCls =
  'block w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

const btnSecondary =
  'px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[13px] font-medium cursor-pointer transition-colors';

const btnDanger =
  'px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border-0 rounded-lg text-[13px] font-medium cursor-pointer transition-colors';

// ── Helpers ───────────────────────────────────────────────────────────────────

function slackChannel(conn: Connection): string | null {
  return (conn.configJson as { defaultChannel?: string } | null)?.defaultChannel ?? null;
}

function webLoginConfig(conn: Connection): { loginUrl?: string; username?: string } {
  return (conn.configJson as { loginUrl?: string; username?: string } | null) ?? {};
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ConnectionsPage({
  user: _user,
  embedded = false,
}: {
  user: User;
  embedded?: boolean;
}) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const location = useLocation();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Type picker
  const [showTypePicker, setShowTypePicker] = useState(false);

  // Web login modal (create or edit)
  const [webLoginModal, setWebLoginModal] = useState<{ conn: Connection | null } | null>(null);
  const [webLoginForm, setWebLoginForm] = useState({
    label: '',
    loginUrl: '',
    username: '',
    password: '',
  });

  // Slack channel config modal
  const [slackConfigConn, setSlackConfigConn] = useState<Connection | null>(null);
  const [defaultChannel, setDefaultChannel] = useState('');

  // Generic "other" connection modal
  const [showGenericModal, setShowGenericModal] = useState(false);
  const [genericForm, setGenericForm] = useState({
    providerType: 'gmail',
    authType: 'oauth2',
    label: '',
    displayName: '',
    accessToken: '',
    refreshToken: '',
    secretsRef: '',
  });

  // ── Load ─────────────────────────────────────────────────────────────────────

  const load = async (options?: { openSlackConfig?: boolean }) => {
    setLoading(true);
    try {
      const { data } = await api.get<Connection[]>(
        `/api/subaccounts/${subaccountId}/connections`,
      );
      const visible = data.filter((c) => c.connectionStatus !== 'revoked');
      setConnections(visible);

      if (options?.openSlackConfig) {
        const newSlack = visible.find(
          (c) => c.providerType === 'slack' && c.connectionStatus === 'active',
        );
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
  };

  // Detect ?connected=slack after OAuth redirect.
  // location.search is in deps so direct navigation to a URL already containing
  // ?connected=slack is handled correctly.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const connected = params.get('connected');
    if (connected === 'slack') {
      window.history.replaceState({}, '', location.pathname);
      load({ openSlackConfig: true });
    } else if (connected) {
      // Other provider OAuth redirect landed on this page via returnPath
      window.history.replaceState({}, '', location.pathname);
      load();
    } else {
      load();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subaccountId, location.search]);

  // ── Slack OAuth ───────────────────────────────────────────────────────────────

  const connectSlack = async () => {
    setError('');
    try {
      const returnPath = location.pathname;
      const { data } = await api.get<{ url: string }>(
        `/api/integrations/oauth2/auth-url?provider=slack&subaccountId=${subaccountId}&returnPath=${encodeURIComponent(returnPath)}`,
      );
      window.location.href = data.url;
    } catch {
      setError('Failed to initiate Slack connection. Check that OAUTH_SLACK_CLIENT_ID is configured.');
    }
  };

  // ── Slack channel config ──────────────────────────────────────────────────────

  const saveSlackChannel = async () => {
    if (!slackConfigConn) return;
    setSaving(true);
    setError('');
    try {
      const existing = slackConfigConn.configJson ?? {};
      await api.patch(`/api/subaccounts/${subaccountId}/connections/${slackConfigConn.id}`, {
        configJson: { ...existing, defaultChannel },
      });
      setSlackConfigConn(null);
      load();
    } catch {
      setError('Failed to save channel');
    } finally {
      setSaving(false);
    }
  };

  // ── Web login ─────────────────────────────────────────────────────────────────

  const openWebLoginEdit = (conn: Connection) => {
    const cfg = webLoginConfig(conn);
    setWebLoginForm({
      label: conn.label ?? '',
      loginUrl: cfg.loginUrl ?? '',
      username: cfg.username ?? '',
      password: '',
    });
    setWebLoginModal({ conn });
    setError('');
  };

  const openWebLoginCreate = () => {
    setWebLoginForm({ label: '', loginUrl: '', username: '', password: '' });
    setWebLoginModal({ conn: null });
    setShowTypePicker(false);
    setError('');
  };

  const saveWebLogin = async () => {
    if (!webLoginForm.label || !webLoginForm.loginUrl || !webLoginForm.username) {
      setError('Label, login URL, and username are required');
      return;
    }
    const isCreate = !webLoginModal?.conn;
    if (isCreate && !webLoginForm.password) {
      setError('Password is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        label: webLoginForm.label,
        config: { loginUrl: webLoginForm.loginUrl, username: webLoginForm.username },
      };
      if (webLoginForm.password) body.password = webLoginForm.password;

      if (isCreate) {
        await api.post(`/api/subaccounts/${subaccountId}/web-login-connections`, body);
      } else {
        // Only promote to active if the user supplied a new password — a
        // label-only edit should not clear an existing error status.
        if (webLoginForm.password) body.connectionStatus = 'active';
        await api.patch(
          `/api/subaccounts/${subaccountId}/web-login-connections/${webLoginModal!.conn!.id}`,
          body,
        );
      }
      setWebLoginModal(null);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to save connection');
    } finally {
      setSaving(false);
    }
  };

  // ── Revoke ────────────────────────────────────────────────────────────────────

  const revoke = async (conn: Connection) => {
    if (!confirm(`Revoke "${conn.label ?? PROVIDER_LABELS[conn.providerType] ?? conn.providerType}"? This cannot be undone.`)) return;
    setError('');
    try {
      if (conn.providerType === 'web_login') {
        await api.delete(`/api/subaccounts/${subaccountId}/web-login-connections/${conn.id}`);
      } else {
        await api.delete(`/api/subaccounts/${subaccountId}/connections/${conn.id}`);
      }
      load();
    } catch {
      setError('Failed to revoke connection');
    }
  };

  // ── Generic connection ────────────────────────────────────────────────────────

  const saveGeneric = async () => {
    setError('');
    try {
      const payload: Record<string, unknown> = {
        providerType: genericForm.providerType,
        authType: genericForm.authType,
        label: genericForm.label || undefined,
        displayName: genericForm.displayName || undefined,
      };
      if (genericForm.authType === 'oauth2') {
        if (genericForm.accessToken) payload.accessToken = genericForm.accessToken;
        if (genericForm.refreshToken) payload.refreshToken = genericForm.refreshToken;
      } else if (genericForm.authType === 'api_key') {
        if (genericForm.secretsRef) payload.secretsRef = genericForm.secretsRef;
      }
      await api.post(`/api/subaccounts/${subaccountId}/connections`, payload);
      setShowGenericModal(false);
      setGenericForm({
        providerType: 'gmail', authType: 'oauth2', label: '', displayName: '',
        accessToken: '', refreshToken: '', secretsRef: '',
      });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create connection');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <>
      <div className="mb-6 flex justify-between items-center">
        {embedded ? (
          <h2 className="text-[18px] font-semibold text-slate-800 m-0">Connections</h2>
        ) : (
          <div>
            <h1 className="text-[28px] font-bold text-slate-800 m-0">Connections</h1>
            <p className="text-[14px] text-slate-500 mt-2 m-0">
              Manage external service connections for this subaccount
            </p>
          </div>
        )}
        <button
          onClick={() => setShowTypePicker(true)}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          + Add Connection
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-5 text-[14px] text-red-600">
          {error}
        </div>
      )}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
        {connections.map((conn) => (
          <ConnectionCard
            key={conn.id}
            conn={conn}
            onRevoke={revoke}
            onEditWebLogin={openWebLoginEdit}
            onConnectSlack={connectSlack}
            onConfigSlack={(c) => {
              setSlackConfigConn(c);
              setDefaultChannel(slackChannel(c) ?? '');
            }}
          />
        ))}
        {connections.length === 0 && (
          <div className="col-span-full py-12 text-center text-[14px] text-slate-400">
            No connections configured yet
          </div>
        )}
      </div>

      {/* ── Type picker ───────────────────────────────────────────────────────── */}
      {showTypePicker && (
        <Modal title="Add Connection" onClose={() => setShowTypePicker(false)} maxWidth={420}>
          <div className="grid gap-3">
            <TypeOption
              icon="💬"
              title="Slack"
              description="Connect your Slack workspace via OAuth — no bot tokens to manage"
              onClick={connectSlack}
            />
            <TypeOption
              icon="🔐"
              title="Web Login"
              description="Store a username and password for a paywalled website"
              onClick={openWebLoginCreate}
            />
            <TypeOption
              icon="⚙️"
              title="Other"
              description="Gmail, HubSpot, GoHighLevel, API keys, and more"
              onClick={() => { setShowTypePicker(false); setShowGenericModal(true); }}
            />
          </div>
        </Modal>
      )}

      {/* ── Web login form ─────────────────────────────────────────────────────── */}
      {webLoginModal && (
        <Modal
          title={webLoginModal.conn ? 'Edit Web Login' : 'Add Web Login'}
          onClose={() => { setWebLoginModal(null); setError(''); }}
          maxWidth={480}
        >
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 text-[13px] text-red-600">
              {error}
            </div>
          )}
          <div className="grid gap-4 mb-6">
            <div>
              <label className="block text-[13px] font-medium text-slate-700">Label *</label>
              <input
                value={webLoginForm.label}
                onChange={(e) => setWebLoginForm({ ...webLoginForm, label: e.target.value })}
                placeholder="e.g. 42 Macro paywall login"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700">Login URL *</label>
              <input
                value={webLoginForm.loginUrl}
                onChange={(e) => setWebLoginForm({ ...webLoginForm, loginUrl: e.target.value })}
                placeholder="https://example.com/login"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700">
                Username / Email *
              </label>
              <input
                value={webLoginForm.username}
                onChange={(e) => setWebLoginForm({ ...webLoginForm, username: e.target.value })}
                placeholder="you@example.com"
                autoComplete="username"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700">
                Password{webLoginModal.conn ? ' (leave blank to keep existing)' : ' *'}
              </label>
              <input
                type="password"
                value={webLoginForm.password}
                onChange={(e) => setWebLoginForm({ ...webLoginForm, password: e.target.value })}
                placeholder={webLoginModal.conn ? '••••••••' : 'Enter password'}
                autoComplete="new-password"
                className={inputCls}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setWebLoginModal(null); setError(''); }}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-lg text-[13px] font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={saveWebLogin}
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors disabled:opacity-60"
            >
              {saving ? 'Saving...' : webLoginModal.conn ? 'Save Changes' : 'Add Connection'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Slack channel config ───────────────────────────────────────────────── */}
      {slackConfigConn && (
        <Modal
          title="Configure Slack"
          onClose={() => setSlackConfigConn(null)}
          maxWidth={420}
        >
          <p className="text-[13px] text-slate-600 mb-4 leading-relaxed">
            Slack is connected. Set the default channel where reports will be posted.
          </p>
          <div className="mb-6">
            <label className="block text-[13px] font-medium text-slate-700">
              Default Channel
            </label>
            <input
              value={defaultChannel}
              onChange={(e) => setDefaultChannel(e.target.value)}
              placeholder="#42macro-reports"
              className={inputCls}
            />
            <p className="text-[12px] text-slate-400 mt-1.5">
              Include the # prefix. The agent also accepts a channel override per run.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setSlackConfigConn(null)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-lg text-[13px] font-medium cursor-pointer"
            >
              Skip for now
            </button>
            <button
              onClick={saveSlackChannel}
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Channel'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Generic connection form ────────────────────────────────────────────── */}
      {showGenericModal && (
        <Modal title="Add Connection" onClose={() => setShowGenericModal(false)} maxWidth={480}>
          <div className="grid gap-4 mb-6">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                  Provider *
                </label>
                <select
                  value={genericForm.providerType}
                  onChange={(e) => setGenericForm({ ...genericForm, providerType: e.target.value })}
                  className={inputCls}
                >
                  {[
                    { value: 'gmail', label: 'Gmail' },
                    { value: 'github', label: 'GitHub' },
                    { value: 'hubspot', label: 'HubSpot' },
                    { value: 'ghl', label: 'GoHighLevel' },
                    { value: 'teamwork', label: 'Teamwork' },
                    { value: 'custom', label: 'Custom' },
                  ].map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                  Auth Type *
                </label>
                <select
                  value={genericForm.authType}
                  onChange={(e) => setGenericForm({ ...genericForm, authType: e.target.value })}
                  className={inputCls}
                >
                  {[
                    { value: 'oauth2', label: 'OAuth 2.0' },
                    { value: 'api_key', label: 'API Key' },
                    { value: 'service_account', label: 'Service Account' },
                  ].map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Label</label>
                <input
                  value={genericForm.label}
                  onChange={(e) => setGenericForm({ ...genericForm, label: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                  Display Name
                </label>
                <input
                  value={genericForm.displayName}
                  onChange={(e) => setGenericForm({ ...genericForm, displayName: e.target.value })}
                  className={inputCls}
                />
              </div>
            </div>
            {genericForm.authType === 'oauth2' && (
              <>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                    Access Token
                  </label>
                  <input
                    type="password"
                    value={genericForm.accessToken}
                    onChange={(e) => setGenericForm({ ...genericForm, accessToken: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                    Refresh Token
                  </label>
                  <input
                    type="password"
                    value={genericForm.refreshToken}
                    onChange={(e) => setGenericForm({ ...genericForm, refreshToken: e.target.value })}
                    className={inputCls}
                  />
                </div>
              </>
            )}
            {genericForm.authType === 'api_key' && (
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                  API Key
                </label>
                <input
                  type="password"
                  value={genericForm.secretsRef}
                  onChange={(e) => setGenericForm({ ...genericForm, secretsRef: e.target.value })}
                  className={inputCls}
                />
              </div>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowGenericModal(false)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-lg text-[13px] font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={saveGeneric}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors"
            >
              Add Connection
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Connection card ───────────────────────────────────────────────────────────

function ConnectionCard({
  conn,
  onRevoke,
  onEditWebLogin,
  onConnectSlack,
  onConfigSlack,
}: {
  conn: Connection;
  onRevoke: (c: Connection) => void;
  onEditWebLogin: (c: Connection) => void;
  onConnectSlack: () => void;
  onConfigSlack: (c: Connection) => void;
}) {
  const isWebLogin = conn.providerType === 'web_login';
  const isSlack = conn.providerType === 'slack';
  const channel = isSlack ? slackChannel(conn) : null;
  const cfg = isWebLogin ? webLoginConfig(conn) : null;
  const label = conn.label ?? PROVIDER_LABELS[conn.providerType] ?? conn.providerType;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="font-bold text-[15px] text-slate-800">
            {PROVIDER_LABELS[conn.providerType] ?? conn.providerType}
          </div>
          {conn.label && (
            <div className="text-[13px] text-slate-500 mt-0.5">{conn.label}</div>
          )}
        </div>
        <span
          className={`text-[12px] font-semibold capitalize px-2 py-0.5 rounded-full ${STATUS_CLS[conn.connectionStatus] ?? 'text-slate-500'} ${STATUS_BG[conn.connectionStatus] ?? 'bg-slate-50'}`}
        >
          {conn.connectionStatus}
        </span>
      </div>

      {/* Provider-specific metadata */}
      <div className="text-[13px] text-slate-500 mb-4 space-y-0.5">
        {isWebLogin && cfg && (
          <>
            <div className="truncate">{cfg.loginUrl}</div>
            <div>{cfg.username}</div>
          </>
        )}
        {isSlack && (
          <div>{channel ? `Posts to ${channel}` : 'No default channel set'}</div>
        )}
        {!isWebLogin && !isSlack && (
          <div>Token: {conn.hasAccessToken ? 'Connected' : 'Not set'}</div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        {isWebLogin && (
          <button onClick={() => onEditWebLogin(conn)} className={btnSecondary}>
            Edit Credentials
          </button>
        )}

        {isSlack && conn.connectionStatus === 'error' && (
          <button
            onClick={onConnectSlack}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors"
          >
            Connect with Slack
          </button>
        )}

        {isSlack && conn.connectionStatus === 'active' && (
          <>
            <button onClick={() => onConfigSlack(conn)} className={btnSecondary}>
              {channel ? 'Edit Channel' : 'Set Channel'}
            </button>
            <button onClick={onConnectSlack} className={btnSecondary}>
              Reconnect
            </button>
          </>
        )}

        <button onClick={() => onRevoke(conn)} className={btnDanger}>
          Revoke
        </button>
      </div>

      {/* Warn if error status and no obvious action */}
      {conn.connectionStatus === 'error' && !isWebLogin && !isSlack && (
        <p className="mt-3 text-[12px] text-amber-600">
          Connection has an error — check credentials or reconnect.
        </p>
      )}
    </div>
  );
}

// ── Type option button ────────────────────────────────────────────────────────

function TypeOption({
  icon,
  title,
  description,
  onClick,
}: {
  icon: string;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 p-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-left cursor-pointer transition-colors"
    >
      <span className="text-2xl leading-none mt-0.5 shrink-0">{icon}</span>
      <div>
        <div className="font-semibold text-[14px] text-slate-800">{title}</div>
        <div className="text-[13px] text-slate-500 mt-0.5">{description}</div>
      </div>
    </button>
  );
}
