# Integrations & Credentials Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone MCP Servers page and hidden Connections page with a unified two-tab page ("Credentials" first, "Integrations" second) available at both org-level and subaccount-level, with OAuth prompting wired into the MCP setup flow.

**Architecture:** Extract `CredentialsTab` from `ConnectionsPage`, add org-level connection API routes (currently missing — causing `/api/org/connections` 404s in `McpCatalogue`), create `IntegrationsAndCredentialsPage` wrapping both tabs, update routing and navigation. The existing `McpServersPage` becomes the Integrations tab (rendered with `embedded={true}`).

**Tech Stack:** React (lazy + Suspense), TypeScript, Express/Drizzle on the backend, existing `integrationConnections` schema, existing `ORG_PERMISSIONS.CONNECTIONS_VIEW/MANAGE` (already defined, just missing routes).

---

## File Map

**Create:**
- `client/src/components/CredentialsTab.tsx` — credentials management UI (OAuth + web logins), org and subaccount scoped
- `client/src/pages/IntegrationsAndCredentialsPage.tsx` — two-tab wrapper page

**Modify:**
- `server/routes/integrationConnections.ts` — add org-level connection routes
- `client/src/App.tsx` — update routes
- `client/src/components/Layout.tsx` — nav label stays "Integrations", no change needed
- `client/src/pages/AdminSubaccountDetailPage.tsx` — update "integrations" tab to use new page

---

## Task 1: Add org-level connection routes to the backend

**Files:**
- Modify: `server/routes/integrationConnections.ts`

The `McpCatalogue` already calls `GET /api/org/connections?provider=slack` to check OAuth status before adding an MCP server. This returns 404, breaking the credential check for all org-scoped MCP setups. We need to add org-level CRUD + the Slack channels endpoint.

- [ ] **Step 1: Add `isNull` and `requireOrgPermission`/`ORG_PERMISSIONS` imports**

In `server/routes/integrationConnections.ts`, change the import lines:

```ts
import { eq, and } from 'drizzle-orm';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
```

to:

```ts
import { eq, and, isNull } from 'drizzle-orm';
import { authenticate, requireSubaccountPermission, requireOrgPermission } from '../middleware/auth.js';
import { SUBACCOUNT_PERMISSIONS, ORG_PERMISSIONS } from '../lib/permissions.js';
```

- [ ] **Step 2: Add org-level connection routes before `export default router`**

Insert the following block immediately before the `export default router;` line at the bottom of the file:

```ts
// ── Org-level connection routes ──────────────────────────────────────────────
// Connections where subaccountId IS NULL are org-scoped (e.g. an org-wide Slack
// bot token rather than a per-client one). These mirror the subaccount routes
// above but use org permission guards and filter on subaccountId IS NULL.

// List org-level connections (optionally filter by ?provider=X)
router.get(
  '/api/org/connections',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const conditions = [
      eq(integrationConnections.organisationId, req.orgId!),
      isNull(integrationConnections.subaccountId),
    ];
    if (req.query.provider) {
      conditions.push(eq(integrationConnections.providerType, req.query.provider as string));
    }
    const rows = await db.select()
      .from(integrationConnections)
      .where(and(...conditions));
    res.json(rows.map(sanitizeConnection));
  })
);

// Create org-level connection
router.post(
  '/api/org/connections',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const { providerType, authType, label, displayName, configJson, accessToken, refreshToken, tokenExpiresAt, secretsRef } = req.body;
    if (!providerType || !authType) {
      throw { statusCode: 400, message: 'providerType and authType are required' };
    }
    const encryptedAccess = accessToken ? connectionTokenService.encryptToken(accessToken) : null;
    const encryptedRefresh = refreshToken ? connectionTokenService.encryptToken(refreshToken) : null;
    const encryptedSecret = secretsRef ? connectionTokenService.encryptToken(secretsRef) : null;
    const [connection] = await db.insert(integrationConnections).values({
      organisationId: req.orgId!,
      subaccountId: null,
      providerType,
      authType,
      label: label ?? null,
      displayName: displayName ?? null,
      configJson: configJson ?? null,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt: tokenExpiresAt ? new Date(tokenExpiresAt) : null,
      secretsRef: encryptedSecret,
      connectionStatus: 'active',
    }).returning();
    res.status(201).json(sanitizeConnection(connection));
  })
);

// Update org-level connection
router.patch(
  '/api/org/connections/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const [existing] = await db.select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, req.params.id),
        eq(integrationConnections.organisationId, req.orgId!),
        isNull(integrationConnections.subaccountId),
      ));
    if (!existing) throw { statusCode: 404, message: 'Connection not found' };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body.label !== undefined) updates.label = req.body.label;
    if (req.body.displayName !== undefined) updates.displayName = req.body.displayName;
    if (req.body.connectionStatus !== undefined) updates.connectionStatus = req.body.connectionStatus;
    if (req.body.configJson !== undefined) updates.configJson = req.body.configJson;
    if (req.body.accessToken) updates.accessToken = connectionTokenService.encryptToken(req.body.accessToken);
    if (req.body.refreshToken) updates.refreshToken = connectionTokenService.encryptToken(req.body.refreshToken);
    if (req.body.tokenExpiresAt) updates.tokenExpiresAt = new Date(req.body.tokenExpiresAt);
    if (req.body.secretsRef) updates.secretsRef = connectionTokenService.encryptToken(req.body.secretsRef);

    const [updated] = await db.update(integrationConnections)
      .set(updates)
      .where(eq(integrationConnections.id, req.params.id))
      .returning();
    res.json(sanitizeConnection(updated));
  })
);

// Revoke org-level connection
router.delete(
  '/api/org/connections/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const [existing] = await db.select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, req.params.id),
        eq(integrationConnections.organisationId, req.orgId!),
        isNull(integrationConnections.subaccountId),
      ));
    if (!existing) throw { statusCode: 404, message: 'Connection not found' };
    await db.update(integrationConnections)
      .set({ connectionStatus: 'revoked', accessToken: null, refreshToken: null, updatedAt: new Date() })
      .where(eq(integrationConnections.id, req.params.id));
    res.json({ success: true });
  })
);

// Fetch Slack channel list for an org-level connection
router.get(
  '/api/org/connections/:id/slack-channels',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const [conn] = await db.select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, req.params.id),
        eq(integrationConnections.organisationId, req.orgId!),
        isNull(integrationConnections.subaccountId),
        eq(integrationConnections.providerType, 'slack'),
      ));
    if (!conn) throw { statusCode: 404, message: 'Slack connection not found' };
    if (!conn.accessToken) throw { statusCode: 422, message: 'Slack connection has no token — reconnect first' };

    const token = connectionTokenService.decryptToken(conn.accessToken);
    const channels: { id: string; name: string }[] = [];
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({ types: 'public_channel', exclude_archived: 'true', limit: '200' });
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(`https://slack.com/api/conversations.list?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await response.json() as {
        ok: boolean;
        channels?: { id: string; name: string }[];
        response_metadata?: { next_cursor?: string };
        error?: string;
      };
      if (!data.ok) throw { statusCode: 502, message: `Slack API error: ${data.error ?? 'unknown'}` };
      for (const ch of data.channels ?? []) channels.push({ id: ch.id, name: ch.name });
      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor && channels.length < 500);
    channels.sort((a, b) => a.name.localeCompare(b.name));
    res.json(channels);
  })
);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run typecheck 2>&1 | grep -E "error|warning" | head -20
```

Expected: no errors in `server/routes/integrationConnections.ts`

- [ ] **Step 4: Commit**

```bash
git add server/routes/integrationConnections.ts
git commit -m "feat: add org-level connection routes (GET/POST/PATCH/DELETE + slack-channels)"
```

---

## Task 2: Create `CredentialsTab` component

**Files:**
- Create: `client/src/components/CredentialsTab.tsx`

This component is extracted and generalised from `ConnectionsPage.tsx`. It manages OAuth connections (Slack) and web logins at either org or subaccount scope, determined by whether `subaccountId` is provided.

- [ ] **Step 1: Read the full ConnectionsPage source to understand all state and handlers**

Read `client/src/pages/ConnectionsPage.tsx` in full before writing CredentialsTab.

- [ ] **Step 2: Create `client/src/components/CredentialsTab.tsx`**

```tsx
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
      const oauthParams: Record<string, string> = {
        provider: 'slack',
        scope: subaccountId ? 'subaccount' : 'org',
        returnPath: encodeURIComponent(returnPath + (returnPath.includes('?') ? '&' : '?') + 'connected=slack'),
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
          <div className="space-y-4 p-4">
            <p className="text-sm text-slate-600">Choose the default channel agents will post to when no channel is specified.</p>
            {channelsLoading ? (
              <p className="text-sm text-slate-400">Loading channels…</p>
            ) : slackChannels.length > 0 ? (
              <select
                value={defaultChannel}
                onChange={e => setDefaultChannel(e.target.value)}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
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
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
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
          </div>
        </Modal>
      )}

      {/* Web login modal */}
      {webLoginModal !== null && (
        <Modal
          title={webLoginModal.conn ? 'Edit Web Login' : 'Add Web Login'}
          onClose={() => setWebLoginModal(null)}
        >
          <div className="space-y-3 p-4">
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
```

- [ ] **Step 3: Verify TypeScript**

```bash
npm run typecheck 2>&1 | grep "CredentialsTab" | head -10
```

Expected: no errors referencing CredentialsTab

- [ ] **Step 4: Commit**

```bash
git add client/src/components/CredentialsTab.tsx
git commit -m "feat: add CredentialsTab component (OAuth + web logins, org and subaccount scope)"
```

---

## Task 3: Create `IntegrationsAndCredentialsPage`

**Files:**
- Create: `client/src/pages/IntegrationsAndCredentialsPage.tsx`

This page has two tabs: "Credentials" (first) and "Integrations" (second). It passes through `subaccountId` to both child components. When `embedded={true}` (used inside `AdminSubaccountDetailPage`) it hides the page-level header.

- [ ] **Step 1: Create the page**

```tsx
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import CredentialsTab from '../components/CredentialsTab';
import McpServersPage from './McpServersPage';

type Tab = 'credentials' | 'integrations';

interface User { id: string; role: string; organisationId?: string }

interface Props {
  user: User;
  subaccountId?: string;
  embedded?: boolean;
}

export default function IntegrationsAndCredentialsPage({ user, subaccountId, embedded = false }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const t = searchParams.get('tab');
    return t === 'integrations' ? 'integrations' : 'credentials';
  });

  // Keep URL in sync with active tab
  useEffect(() => {
    setSearchParams(p => { p.set('tab', activeTab); return p; }, { replace: true });
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: { id: Tab; label: string }[] = [
    { id: 'credentials', label: 'Credentials' },
    { id: 'integrations', label: 'Integrations' },
  ];

  return (
    <div className={embedded ? '' : 'p-6'}>
      {!embedded && (
        <h1 className="text-xl font-semibold text-slate-800 mb-6">Integrations &amp; Credentials</h1>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-slate-800 text-slate-800'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'credentials' && (
        <CredentialsTab user={user} subaccountId={subaccountId} />
      )}

      {activeTab === 'integrations' && (
        <McpServersPage user={user} subaccountId={subaccountId} embedded={true} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npm run typecheck 2>&1 | grep "IntegrationsAndCredentialsPage\|CredentialsTab" | head -10
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/IntegrationsAndCredentialsPage.tsx
git commit -m "feat: add IntegrationsAndCredentialsPage with Credentials + Integrations tabs"
```

---

## Task 4: Update routing and navigation

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/pages/AdminSubaccountDetailPage.tsx`

- [ ] **Step 1: Read App.tsx to understand current import and route structure**

Read `client/src/App.tsx` lines 1–100 and lines 180–240.

- [ ] **Step 2: Add IntegrationsAndCredentialsPage import to App.tsx**

After the existing `const McpServersPage = lazy(...)` line, add:

```tsx
const IntegrationsAndCredentialsPage = lazy(() => import('./pages/IntegrationsAndCredentialsPage'));
```

- [ ] **Step 3: Update the `/admin/mcp-servers` route in App.tsx**

Find:
```tsx
<Route path="/admin/mcp-servers" element={<McpServersPage user={user!} />} />
```

Replace with:
```tsx
<Route path="/admin/mcp-servers" element={<IntegrationsAndCredentialsPage user={user!} />} />
```

- [ ] **Step 4: Update the subaccount connections routes in App.tsx**

Find:
```tsx
<Route path="/admin/subaccounts/:subaccountId/connections" element={<ConnectionsPage user={user!} />} />
<Route path="/portal/:subaccountId/connections" element={<ConnectionsPage user={user!} />} />
```

Replace with (note: `subaccountId` must be read from route params — use a wrapper or RouteElement pattern already used in the file):

Check how the file handles `subaccountId` in similar routes (look for how `AdminSubaccountDetailPage` or similar components get `subaccountId` from params). If the file uses a wrapper component to extract params, follow that pattern. If it uses inline hooks, use:

```tsx
<Route
  path="/admin/subaccounts/:subaccountId/connections"
  element={<SubaccountIntegrationsRoute user={user!} />}
/>
<Route
  path="/portal/:subaccountId/connections"
  element={<SubaccountIntegrationsRoute user={user!} />}
/>
```

And add this small inline helper near the top of the authenticated section (or wherever similar helpers live in the file):

```tsx
function SubaccountIntegrationsRoute({ user }: { user: User }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  return <IntegrationsAndCredentialsPage user={user} subaccountId={subaccountId} />;
}
```

If the codebase already has `useParams` called inline in JSX or uses a different pattern, follow that instead.

- [ ] **Step 5: Read AdminSubaccountDetailPage to find the integrations tab**

Read `client/src/pages/AdminSubaccountDetailPage.tsx` and locate the tab that renders `<McpServersPage>`.

- [ ] **Step 6: Update the integrations tab in AdminSubaccountDetailPage**

Find the tab render that uses `<McpServersPage ... />` inside the subaccount detail page. Replace it with:

```tsx
<IntegrationsAndCredentialsPage user={user} subaccountId={subaccount.id} embedded={true} />
```

Add the import for `IntegrationsAndCredentialsPage` at the top of the file (or as a lazy import following the pattern used by the other imports in that file).

- [ ] **Step 7: Verify TypeScript and build**

```bash
npm run typecheck 2>&1 | grep error | head -20
```

Expected: no errors. Fix any type errors before proceeding.

- [ ] **Step 8: Commit**

```bash
git add client/src/App.tsx client/src/pages/AdminSubaccountDetailPage.tsx
git commit -m "feat: route /admin/mcp-servers and subaccount connections to IntegrationsAndCredentialsPage"
```

---

## Task 5: Remove ConnectionsPage from routing (clean up)

**Files:**
- Modify: `client/src/App.tsx`

`ConnectionsPage` is now fully replaced by `CredentialsTab` inside `IntegrationsAndCredentialsPage`. Remove the stale import and lazy import to keep the bundle clean.

- [ ] **Step 1: Remove `ConnectionsPage` import from App.tsx**

Find and delete:
```tsx
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage'));
```

- [ ] **Step 2: Verify no remaining references**

```bash
grep -n "ConnectionsPage" client/src/App.tsx
```

Expected: no output (all references removed).

- [ ] **Step 3: Verify TypeScript**

```bash
npm run typecheck 2>&1 | grep error | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx
git commit -m "chore: remove stale ConnectionsPage import from App.tsx"
```

---

## Task 6: Final verification

- [ ] **Step 1: Run full typecheck**

```bash
npm run typecheck 2>&1 | tail -5
```

Expected: `Found 0 errors.`

- [ ] **Step 2: Run lint**

```bash
npm run lint 2>&1 | tail -10
```

Expected: no errors. Fix any that appear.

- [ ] **Step 3: Verify the org-level connections endpoint manually**

```bash
# Start the server in a separate terminal, then:
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/org/connections \
  -H "Cookie: <your session cookie>"
```

Expected: `200` (or `401` if not logged in — not `404`). The route must be registered.

- [ ] **Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "fix: address lint warnings from integrations-credentials refactor"
```
