import { useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface OrgUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
}

const STATUS_TEXT: Record<string, string> = {
  active:   'text-green-600',
  inactive: 'text-slate-500',
  pending:  'text-amber-600',
};

const MANAGER_ASSIGNABLE_ROLES = ['user', 'client_user'];
const ADMIN_ASSIGNABLE_ROLES = ['org_admin', 'manager', 'user', 'client_user'];

export default function AdminUsersPage({ user }: { user: User }) {
  const isManager = user.role === 'manager';
  const assignableRoles = isManager ? MANAGER_ASSIGNABLE_ROLES : ADMIN_ASSIGNABLE_ROLES;

  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [form, setForm] = useState({ email: '', role: 'user', firstName: '', lastName: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const load = async () => {
    try {
      const { data } = await api.get('/api/users');
      if (mountedRef.current) { setUsers(data); setLoading(false); }
    } catch {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleInvite = async () => {
    setError('');
    setSuccess('');
    try {
      await api.post('/api/users/invite', form);
      setSuccess(`Invitation sent to ${form.email}`);
      toast.success(`Invitation sent to ${form.email}`);
      setShowInviteForm(false);
      setForm({ email: '', role: 'user', firstName: '', lastName: '' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to send invitation');
    }
  };

  const handleUpdateRole = async (userId: string, role: string) => {
    setError('');
    try {
      await api.patch(`/api/users/${userId}`, { role });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to update role');
    }
  };

  const handleUpdateStatus = async (userId: string, status: string) => {
    setError('');
    try {
      await api.patch(`/api/users/${userId}`, { status });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to update status');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteUserId) return;
    setError('');
    try {
      await api.delete(`/api/users/${deleteUserId}`);
      toast.success('User removed');
      setDeleteUserId(null);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to remove user');
      setDeleteUserId(null);
    }
  };

  const deleteUserObj = deleteUserId ? users.find((u) => u.id === deleteUserId) : null;

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">Users</h1>
          <p className="text-sm text-slate-500 mt-2">Manage team members and their access</p>
        </div>
        <button
          onClick={() => { setShowInviteForm(true); setError(''); }}
          className="btn btn-primary"
        >
          + Invite user
        </button>
      </div>

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-5 text-sm text-green-700">{success}</div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-5 text-sm text-red-600">{error}</div>
      )}

      {showInviteForm && (
        <Modal title="Invite new user" onClose={() => setShowInviteForm(false)} maxWidth={480}>
          {error && <div className="text-[13px] text-red-600 mb-3">{error}</div>}
          <div className="grid gap-4 mb-6">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">First name *</label>
                <input
                  autoFocus
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Last name *</label>
                <input
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Email *</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="name@company.com"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Role *</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {assignableRoles.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowInviteForm(false)}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleInvite}
              className="btn btn-primary"
            >
              Send invitation
            </button>
          </div>
        </Modal>
      )}

      {deleteUserId && (
        <ConfirmDialog
          title="Remove user"
          message={`Remove ${deleteUserObj ? `${deleteUserObj.firstName} ${deleteUserObj.lastName} (${deleteUserObj.email})` : 'this user'} from the organisation? This action cannot be undone.`}
          confirmLabel="Remove"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteUserId(null)}
        />
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Name</th>
              <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Email</th>
              <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Role</th>
              <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Status</th>
              <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Last login</th>
              <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-medium text-slate-800">{u.firstName} {u.lastName}</td>
                <td className="px-4 py-3 text-slate-500 text-[13px]">{u.email}</td>
                <td className="px-4 py-3">
                  {u.role === 'system_admin' || (isManager && !assignableRoles.includes(u.role)) ? (
                    <span className={u.role === 'system_admin' ? 'text-violet-700 font-medium text-[13px]' : 'text-[13px] text-slate-600'}>{u.role}</span>
                  ) : (
                    <select
                      value={u.role}
                      onChange={(e) => handleUpdateRole(u.id, e.target.value)}
                      className="px-2 py-1 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    >
                      {assignableRoles.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  )}
                </td>
                <td className="px-4 py-3">
                  <select
                    value={u.status}
                    onChange={(e) => handleUpdateStatus(u.id, e.target.value)}
                    className={`px-2 py-1 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 ${STATUS_TEXT[u.status] ?? 'text-slate-600'}`}
                  >
                    {['active', 'inactive'].map((s) => <option key={s} value={s}>{s}</option>)}
                    {u.status === 'pending' && <option value="pending">pending</option>}
                  </select>
                </td>
                <td className="px-4 py-3 text-[13px] text-slate-500">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                </td>
                <td className="px-4 py-3">
                  {u.id !== user.id && (
                    <button
                      onClick={() => setDeleteUserId(u.id)}
                      className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-md text-xs font-medium transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
