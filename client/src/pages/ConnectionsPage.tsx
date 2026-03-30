import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Connection {
  id: string;
  providerType: string;
  authType: string;
  connectionStatus: string;
  label: string | null;
  displayName: string | null;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  tokenExpiresAt: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
}

const providerOptions = ['gmail', 'github', 'hubspot', 'slack', 'ghl', 'custom'];
const authOptions = ['oauth2', 'api_key', 'service_account'];

export default function ConnectionsPage({ user }: { user: User }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ providerType: 'gmail', authType: 'oauth2', label: '', displayName: '', accessToken: '', refreshToken: '', secretsRef: '' });

  const load = () => {
    api.get(`/api/subaccounts/${subaccountId}/connections`)
      .then(({ data }) => setConnections(data))
      .catch(() => setError('Failed to load connections'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [subaccountId]);

  const handleCreate = async () => {
    try {
      const payload: Record<string, unknown> = {
        providerType: form.providerType,
        authType: form.authType,
        label: form.label || undefined,
        displayName: form.displayName || undefined,
      };
      if (form.authType === 'oauth2') {
        if (form.accessToken) payload.accessToken = form.accessToken;
        if (form.refreshToken) payload.refreshToken = form.refreshToken;
      } else if (form.authType === 'api_key') {
        if (form.secretsRef) payload.secretsRef = form.secretsRef;
      }
      await api.post(`/api/subaccounts/${subaccountId}/connections`, payload);
      setShowCreate(false);
      setForm({ providerType: 'gmail', authType: 'oauth2', label: '', displayName: '', accessToken: '', refreshToken: '', secretsRef: '' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create connection');
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke this connection? This cannot be undone.')) return;
    await api.delete(`/api/subaccounts/${subaccountId}/connections/${id}`);
    load();
  };

  if (loading) return <div>Loading...</div>;

  const statusColors: Record<string, string> = {
    active: '#16a34a',
    revoked: '#dc2626',
    error: '#f59e0b',
  };

  return (
    <>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>Connections</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>Manage external service connections for this subaccount</p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 }}>
          + Add Connection
        </button>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#dc2626', fontSize: 14 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {connections.map(c => (
          <div key={c.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#1e293b', textTransform: 'capitalize' }}>{c.providerType}</div>
                {c.label && <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{c.label}</div>}
                {c.displayName && <div style={{ fontSize: 13, color: '#64748b' }}>{c.displayName}</div>}
              </div>
              <span style={{ color: statusColors[c.connectionStatus] ?? '#64748b', fontWeight: 600, fontSize: 13, textTransform: 'capitalize' }}>
                {c.connectionStatus}
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>
              Auth: {c.authType} | Token: {c.hasAccessToken ? 'Yes' : 'No'}
              {c.tokenExpiresAt && <> | Expires: {new Date(c.tokenExpiresAt).toLocaleDateString()}</>}
            </div>
            {c.connectionStatus === 'active' && (
              <button onClick={() => handleRevoke(c.id)} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>
                Revoke
              </button>
            )}
          </div>
        ))}
        {connections.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '40px 0', textAlign: 'center', color: '#94a3b8' }}>No connections configured yet</div>
        )}
      </div>

      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 32, width: 460 }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 700 }}>Add Connection</h2>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Provider</span>
              <select value={form.providerType} onChange={e => setForm({ ...form, providerType: e.target.value })} style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6 }}>
                {providerOptions.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Auth Type</span>
              <select value={form.authType} onChange={e => setForm({ ...form, authType: e.target.value })} style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6 }}>
                {authOptions.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Label (optional)</span>
              <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="e.g. Support Gmail" style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6 }} />
            </label>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Display Name (optional)</span>
              <input value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6 }} />
            </label>
            {form.authType === 'oauth2' && (
              <>
                <label style={{ display: 'block', marginBottom: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Access Token</span>
                  <input value={form.accessToken} onChange={e => setForm({ ...form, accessToken: e.target.value })} type="password" style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6 }} />
                </label>
                <label style={{ display: 'block', marginBottom: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Refresh Token</span>
                  <input value={form.refreshToken} onChange={e => setForm({ ...form, refreshToken: e.target.value })} type="password" style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6 }} />
                </label>
              </>
            )}
            {form.authType === 'api_key' && (
              <label style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>API Key</span>
                <input value={form.secretsRef} onChange={e => setForm({ ...form, secretsRef: e.target.value })} type="password" style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6 }} />
              </label>
            )}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setShowCreate(false)} style={{ background: '#e2e8f0', color: '#374151', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreate} style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}>Add Connection</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
