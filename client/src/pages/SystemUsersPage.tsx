import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';

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

const STATUS_CLS: Record<string, string> = {
  active: 'text-green-600',
  inactive: 'text-slate-500',
  pending: 'text-amber-600',
};

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

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

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">System Admins</h1>
          <p className="text-slate-500 mt-2 mb-0">Manage platform-level administrator accounts</p>
        </div>
        <button
          onClick={() => { setShowInviteForm(true); setError(''); setSuccess(''); }}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
        >
          + Invite system admin
        </button>
      </div>

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-5 text-green-700 text-[14px]">
          {success}
        </div>
      )}
      {error && !showInviteForm && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-5 text-red-600 text-[14px]">
          {error}
        </div>
      )}

      {showInviteForm && (
        <Modal title="Invite system admin" onClose={() => { setShowInviteForm(false); setError(''); }} maxWidth={520}>
          <p className="text-[13px] text-slate-500 m-0 mb-4">
            The invited person will receive full platform admin access.
          </p>
          {error && (
            <div className="text-red-600 text-[13px] mb-3">{error}</div>
          )}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="col-span-2">
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Email *</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={inputCls}
                placeholder="admin@example.com"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">First name</label>
              <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Last name</label>
              <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={inputCls} />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleInvite}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[13px] font-medium cursor-pointer transition-colors"
            >
              Send invitation
            </button>
            <button
              onClick={() => { setShowInviteForm(false); setError(''); }}
              className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-lg text-[13px] cursor-pointer transition-colors"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Name</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Email</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Last login</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {systemUsers.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 px-4 text-center text-slate-400 text-[14px]">
                  No system admins found.
                </td>
              </tr>
            )}
            {systemUsers.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium text-slate-800">
                  {u.firstName || u.lastName ? `${u.firstName} ${u.lastName}`.trim() : '—'}
                  {u.id === user.id && (
                    <span className="ml-2 text-[11px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">You</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={`text-[12px] font-medium ${STATUS_CLS[u.status] ?? 'text-slate-700'}`}>
                    {u.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500 text-[13px]">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                </td>
                <td className="px-4 py-3 text-slate-500 text-[13px]">
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
