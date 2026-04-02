import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';

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

const providerOptions: { value: string; label: string }[] = [
  { value: 'gmail', label: 'Gmail' },
  { value: 'github', label: 'GitHub' },
  { value: 'hubspot', label: 'HubSpot' },
  { value: 'slack', label: 'Slack' },
  { value: 'ghl', label: 'GoHighLevel' },
  { value: 'custom', label: 'Custom' },
];
const authOptions: { value: string; label: string }[] = [
  { value: 'oauth2', label: 'OAuth 2.0' },
  { value: 'api_key', label: 'API Key' },
  { value: 'service_account', label: 'Service Account' },
];

const inputCls = 'block w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

const STATUS_STYLES: Record<string, string> = {
  active: 'text-green-600',
  revoked: 'text-red-600',
  error: 'text-amber-600',
};

const providerLabel = (v: string) => providerOptions.find((p) => p.value === v)?.label ?? v;
const authLabel = (v: string) => authOptions.find((a) => a.value === v)?.label ?? v;

export default function ConnectionsPage({ user: _user, embedded = false }: { user: User; embedded?: boolean }) {
  const params = useParams<{ subaccountId: string }>();
  const subaccountId = params.subaccountId;
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ providerType: 'gmail', authType: 'oauth2', label: '', displayName: '', accessToken: '', refreshToken: '', secretsRef: '' });

  const load = () => {
    api.get(`/api/subaccounts/${subaccountId}/connections`)
      .then(({ data }) => setConnections(data))
      .catch((err) => { console.error('[Connections] Failed to load connections:', err); setError('Failed to load connections'); })
      .finally(() => setLoading(false));
  };

  useEffect(load, [subaccountId]);

  const handleCreate = async () => {
    try {
      const payload: Record<string, unknown> = {
        providerType: form.providerType, authType: form.authType,
        label: form.label || undefined, displayName: form.displayName || undefined,
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

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <>
      <div className="mb-6 flex justify-between items-center">
        {!embedded && (
          <div>
            <h1 className="text-[28px] font-bold text-slate-800 m-0">Connections</h1>
            <p className="text-[14px] text-slate-500 mt-2 m-0">Manage external service connections for this subaccount</p>
          </div>
        )}
        {embedded && <h2 className="text-[18px] font-semibold text-slate-800 m-0">Connections</h2>}
        <button onClick={() => setShowCreate(true)} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors">
          + Add Connection
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-5 text-[14px] text-red-600">{error}</div>
      )}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
        {connections.map((c) => (
          <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="font-bold text-[16px] text-slate-800">{providerLabel(c.providerType)}</div>
                {c.label && <div className="text-[13px] text-slate-500 mt-0.5">{c.label}</div>}
                {c.displayName && <div className="text-[13px] text-slate-500">{c.displayName}</div>}
              </div>
              <span className={`font-semibold text-[13px] capitalize ${STATUS_STYLES[c.connectionStatus] ?? 'text-slate-500'}`}>
                {c.connectionStatus}
              </span>
            </div>
            <div className="text-[13px] text-slate-500 mb-3">
              {authLabel(c.authType)} | Token: {c.hasAccessToken ? 'Yes' : 'No'}
              {c.tokenExpiresAt && <> | Expires: {new Date(c.tokenExpiresAt).toLocaleDateString()}</>}
            </div>
            {c.connectionStatus === 'active' && (
              <button onClick={() => handleRevoke(c.id)} className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border-0 rounded-lg text-[13px] font-medium cursor-pointer transition-colors">
                Revoke
              </button>
            )}
          </div>
        ))}
        {connections.length === 0 && (
          <div className="col-span-full py-12 text-center text-[14px] text-slate-400">No connections configured yet</div>
        )}
      </div>

      {showCreate && (
        <Modal title="Add Connection" onClose={() => setShowCreate(false)} maxWidth={480}>
          <div className="grid gap-4 mb-6">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Provider *</label>
                <select value={form.providerType} onChange={(e) => setForm({ ...form, providerType: e.target.value })} className={inputCls}>
                  {providerOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Auth Type *</label>
                <select value={form.authType} onChange={(e) => setForm({ ...form, authType: e.target.value })} className={inputCls}>
                  {authOptions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Label</label>
                <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Support Gmail" className={inputCls} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Display Name</label>
                <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="e.g. Main Account" className={inputCls} />
              </div>
            </div>
            {form.authType === 'oauth2' && (
              <>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Access Token</label>
                  <input value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} type="password" className={inputCls} />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Refresh Token</label>
                  <input value={form.refreshToken} onChange={(e) => setForm({ ...form, refreshToken: e.target.value })} type="password" className={inputCls} />
                </div>
              </>
            )}
            {form.authType === 'api_key' && (
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">API Key</label>
                <input value={form.secretsRef} onChange={(e) => setForm({ ...form, secretsRef: e.target.value })} type="password" className={inputCls} />
              </div>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-lg text-[13px] font-medium cursor-pointer">Cancel</button>
            <button onClick={handleCreate} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors">Add Connection</button>
          </div>
        </Modal>
      )}
    </>
  );
}
