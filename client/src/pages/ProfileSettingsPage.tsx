import { useEffect, useState, FormEvent } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';

export default function ProfileSettingsPage({ user }: { user: User }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/users/me').then(({ data }) => {
      setFirstName(data.firstName);
      setLastName(data.lastName);
    }).finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      const body: Record<string, string> = { firstName, lastName };
      if (newPassword) {
        body.currentPassword = currentPassword;
        body.newPassword = newPassword;
      }
      await api.patch('/api/users/me', body);
      setSuccess('Profile updated successfully');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to update profile');
    }
  };

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <div className="max-w-[480px]">
      <h1 className="text-[28px] font-bold text-slate-800 mb-2">Profile Settings</h1>
      <p className="text-sm text-slate-500 mb-8">Update your personal information and password.</p>

      <div className="bg-sky-50 border border-sky-200 rounded-lg px-4 py-3 mb-6 text-[13px] text-sky-800">
        <strong>Role:</strong> {user.role} &nbsp;|&nbsp; <strong>Email:</strong> {user.email}
      </div>

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-5 text-sm text-green-700">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-5 text-sm text-red-600">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">First name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Last name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-5 mb-5">
          <div className="text-sm font-semibold text-slate-700 mb-3">Change password (optional)</div>
          <div className="mb-3">
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Current password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">New password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        </div>

        <button
          type="submit"
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          Save changes
        </button>
      </form>
    </div>
  );
}
