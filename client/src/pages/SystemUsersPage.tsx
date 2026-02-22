import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';

interface SystemUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: '#16a34a',
  inactive: '#6b7280',
  pending: '#d97706',
};

export default function SystemUsersPage({ user }: { user: User }) {
  const [systemUsers, setSystemUsers] = useState<SystemUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    try {
      const { data } = await api.get('/api/system/users');
      setSystemUsers(data);
    } catch {
      setError('Failed to load system admins');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleInvite = async () => {
    setError('');
    setSuccess('');
    try {
      await api.post('/api/system/users/invite', form);
      setSuccess(`Invitation sent to ${form.email}`);
      setShowInviteForm(false);
      setForm({ email: '', firstName: '', lastName: '' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to send invitation');
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>System Admins</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>Manage platform-level administrator accounts</p>
        </div>
        <button
          onClick={() => { setShowInviteForm(true); setError(''); setSuccess(''); }}
          style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}
        >
          + Invite system admin
        </button>
      </div>

      {success && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#16a34a', fontSize: 14 }}>
          {success}
        </div>
      )}
      {error && !showInviteForm && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#dc2626', fontSize: 14 }}>
          {error}
        </div>
      )}

      {showInviteForm && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 24, border: '1px solid #e2e8f0', marginBottom: 24, maxWidth: 520 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Invite system admin</h2>
          <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
            The invited person will receive full platform admin access.
          </p>
          {error && (
            <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Email *</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                placeholder="admin@example.com"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>First name</label>
              <input
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Last name</label>
              <input
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={handleInvite}
              style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}
            >
              Send invitation
            </button>
            <button
              onClick={() => { setShowInviteForm(false); setError(''); }}
              style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Name</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Email</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Status</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Last login</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Joined</th>
            </tr>
          </thead>
          <tbody>
            {systemUsers.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '24px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                  No system admins found.
                </td>
              </tr>
            )}
            {systemUsers.map((u) => (
              <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px 16px', fontWeight: 500, color: '#1e293b' }}>
                  {u.firstName || u.lastName ? `${u.firstName} ${u.lastName}`.trim() : '—'}
                  {u.id === user.id && (
                    <span style={{ marginLeft: 8, fontSize: 11, background: '#eff6ff', color: '#2563eb', padding: '2px 6px', borderRadius: 4 }}>You</span>
                  )}
                </td>
                <td style={{ padding: '12px 16px', color: '#64748b' }}>{u.email}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: STATUS_COLORS[u.status] ?? '#374151' }}>
                    {u.status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', color: '#64748b', fontSize: 13 }}>
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                </td>
                <td style={{ padding: '12px 16px', color: '#64748b', fontSize: 13 }}>
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
