import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User, getActiveClientId, getActiveClientName } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface Member {
  assignmentId: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  permissionSetId: string;
  permissionSetName: string;
}

interface PermissionSet { id: string; name: string; }

interface CreatedMember {
  email: string;
  firstName: string;
  lastName: string;
  temporaryPassword: string;
}

const ROLES = ['user', 'manager', 'org_admin', 'client_user'];

export default function SubaccountTeamPage({ user: _user }: { user: User }) {
  const clientId = getActiveClientId();
  const clientName = getActiveClientName();

  const [members, setMembers] = useState<Member[]>([]);
  const [permissionSets, setPermissionSets] = useState<PermissionSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Add member modal
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ email: '', firstName: '', lastName: '', role: 'user' });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');

  // Credentials display after creation
  const [createdMember, setCreatedMember] = useState<CreatedMember | null>(null);
  const [copied, setCopied] = useState(false);

  // Remove
  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);

  const load = async () => {
    if (!clientId) { setLoading(false); return; }
    try {
      const [membersRes, psRes] = await Promise.all([
        api.get(`/api/subaccounts/${clientId}/members`),
        api.get('/api/permission-sets').catch(() => ({ data: [] })),
      ]);
      setMembers(membersRes.data);
      setPermissionSets(psRes.data);
    } catch {
      setError('Failed to load team members');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [clientId]);

  const handleAdd = async () => {
    if (!addForm.email.trim() || !addForm.firstName.trim() || !addForm.lastName.trim()) {
      setAddError('All fields are required');
      return;
    }
    setAddLoading(true);
    setAddError('');
    try {
      // Create the user in the org with a generated password
      const { data } = await api.post('/api/users/create-member', {
        email: addForm.email.trim(),
        firstName: addForm.firstName.trim(),
        lastName: addForm.lastName.trim(),
        role: addForm.role,
      });

      // Auto-assign to this subaccount with first permission set
      if (clientId && permissionSets.length > 0) {
        await api.post(`/api/subaccounts/${clientId}/members`, {
          userId: data.id,
          permissionSetId: permissionSets[0].id,
        }).catch(() => { /* user created but assignment failed — still show credentials */ });
      }

      setCreatedMember({
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        temporaryPassword: data.temporaryPassword,
      });
      setShowAdd(false);
      setAddForm({ email: '', firstName: '', lastName: '', role: 'user' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; message?: string } } };
      setAddError(e.response?.data?.error ?? e.response?.data?.message ?? 'Failed to create team member');
    } finally {
      setAddLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!removeMemberId || !clientId) return;
    await api.delete(`/api/subaccounts/${clientId}/members/${removeMemberId}`);
    setRemoveMemberId(null);
    load();
  };

  const handleUpdateRole = async (userId: string, permissionSetId: string) => {
    if (!clientId) return;
    await api.patch(`/api/subaccounts/${clientId}/members/${userId}`, { permissionSetId });
    load();
  };

  const handleCopyCredentials = () => {
    if (!createdMember) return;
    const text = `Welcome to ${clientName ?? 'the team'}!\n\nEmail: ${createdMember.email}\nTemporary password: ${createdMember.temporaryPassword}\n\nPlease log in and change your password.`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!clientId) {
    return (
      <div className="animate-[fadeIn_0.2s_ease-out_both] flex flex-col items-center justify-center py-20 text-center">
        <div className="font-bold text-[18px] text-slate-900 mb-2">No company selected</div>
        <div className="text-[14px] text-slate-500">Select a company from the sidebar to manage team members.</div>
      </div>
    );
  }

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-slate-900 tracking-tight m-0">Team</h1>
          {clientName && <div className="text-[13px] text-slate-500 mt-0.5">{clientName}</div>}
        </div>
        <button
          onClick={() => { setShowAdd(true); setAddError(''); }}
          className="btn btn-sm btn-primary"
        >
          + Add Team Member
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-5 text-[14px] text-red-600">{error}</div>}

      {/* Members table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {members.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">No team members yet. Add your first team member to get started.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Name</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Email</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Permission set</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m) => (
                <tr key={m.assignmentId} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{m.firstName} {m.lastName}</div>
                    <div className="text-[12px] text-slate-400 capitalize">{m.status}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{m.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={m.permissionSetId}
                      onChange={(e) => handleUpdateRole(m.userId, e.target.value)}
                      className="px-2.5 py-1.5 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    >
                      {permissionSets.map((ps) => <option key={ps.id} value={ps.id}>{ps.name}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setRemoveMemberId(m.userId)}
                      className="btn btn-xs btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add member modal */}
      {showAdd && (
        <Modal title="Add Team Member" onClose={() => setShowAdd(false)} maxWidth={480}>
          {addError && <div className="text-[13px] text-red-600 mb-3">{addError}</div>}
          <div className="grid gap-4 mb-6">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">First name *</label>
                <input
                  autoFocus
                  value={addForm.firstName}
                  onChange={(e) => setAddForm({ ...addForm, firstName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Last name *</label>
                <input
                  value={addForm.lastName}
                  onChange={(e) => setAddForm({ ...addForm, lastName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Email *</label>
              <input
                type="email"
                value={addForm.email}
                onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                placeholder="name@company.com"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Role</label>
              <select
                value={addForm.role}
                onChange={(e) => setAddForm({ ...addForm, role: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="btn btn-sm btn-secondary">Cancel</button>
            <button
              onClick={handleAdd}
              disabled={addLoading || !addForm.email.trim() || !addForm.firstName.trim() || !addForm.lastName.trim()}
              className="btn btn-sm btn-primary disabled:opacity-50"
            >
              {addLoading ? 'Creating...' : 'Create Member'}
            </button>
          </div>
        </Modal>
      )}

      {/* Credentials modal — shown after successful creation */}
      {createdMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out_both]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-[17px] font-bold text-slate-900 m-0">Team Member Created</h2>
              <button onClick={() => { setCreatedMember(null); setCopied(false); }} className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
            </div>
            <div className="p-6">
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4 text-[13px] text-green-700">
                Account created successfully. Share these credentials with the team member.
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 font-mono text-[13px] text-slate-800 space-y-1">
                <div><span className="text-slate-500">Name:</span> {createdMember.firstName} {createdMember.lastName}</div>
                <div><span className="text-slate-500">Email:</span> {createdMember.email}</div>
                <div><span className="text-slate-500">Password:</span> <span className="font-bold text-indigo-600">{createdMember.temporaryPassword}</span></div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleCopyCredentials}
                  className="flex-1 btn btn-primary"
                >
                  {copied ? 'Copied!' : 'Copy Login Instructions'}
                </button>
                <button
                  onClick={() => { setCreatedMember(null); setCopied(false); }}
                  className="btn btn-secondary"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Remove confirm */}
      {removeMemberId && (
        <ConfirmDialog
          title="Remove team member"
          message="Remove this member's access to this company? They will still exist in the organisation."
          confirmLabel="Remove"
          onConfirm={handleRemove}
          onCancel={() => setRemoveMemberId(null)}
        />
      )}
    </div>
  );
}
