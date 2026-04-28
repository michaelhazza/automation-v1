import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface Organisation {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  createdAt: string;
  settings?: Record<string, unknown> | null;
}

interface OrgUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
}

const ADMIN_ASSIGNABLE_ROLES = ['org_admin', 'manager', 'user', 'client_user'];

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
const labelCls = 'block text-[13px] font-medium text-slate-700 mb-1.5';

export default function SystemOrganisationsPage({ user: _user }: { user: User }) {
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', slug: '', plan: 'starter', adminEmail: '', adminFirstName: '', adminLastName: '', configTemplateId: '' });
  const [createError, setCreateError] = useState('');
  const [configTemplates, setConfigTemplates] = useState<Array<{ id: string; name: string; description: string | null }>>([]);

  useEffect(() => {
    api.get('/api/system/company-templates').then(({ data }) => {
      setConfigTemplates(data.filter((t: { isPublished: boolean }) => t.isPublished));
    }).catch(() => {});
  }, []);

  const [editOrg, setEditOrg] = useState<Organisation | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [editError, setEditError] = useState('');

  const [usersOrg, setUsersOrg] = useState<Organisation | null>(null);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [usersSuccess, setUsersSuccess] = useState('');
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'user', firstName: '', lastName: '' });
  const [removeUserId, setRemoveUserId] = useState<string | null>(null);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');

  const loadOrgs = async () => {
    const { data } = await api.get('/api/organisations');
    setOrgs(data);
    setLoading(false);
  };

  useEffect(() => { loadOrgs(); }, []);

  const handleCreate = async () => {
    setCreateError('');
    try {
      const { configTemplateId, ...orgData } = createForm;
      const { data: org } = await api.post('/api/organisations', orgData);
      // Apply configuration template if selected
      if (configTemplateId) {
        try {
          await api.post(`/api/system/company-templates/${configTemplateId}/load-to-org`, {
            organisationId: org.id,
          });
        } catch {
          // Org created but template failed — don't block, just warn
          setCreateError('Organisation created but configuration template failed to apply. You can apply it manually later.');
          loadOrgs();
          return;
        }
      }
      setShowCreateForm(false);
      setCreateForm({ name: '', slug: '', plan: 'starter', adminEmail: '', adminFirstName: '', adminLastName: '', configTemplateId: '' });
      loadOrgs();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setCreateError(e.response?.data?.error ?? 'Failed to create organisation');
    }
  };

  const handleUpdateStatus = async (id: string, status: string) => {
    await api.patch(`/api/organisations/${id}`, { status });
    loadOrgs();
  };

  const handleUpdatePlan = async (id: string, plan: string) => {
    await api.patch(`/api/organisations/${id}`, { plan });
    loadOrgs();
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    await api.delete(`/api/organisations/${deleteId}`);
    setDeleteId(null);
    loadOrgs();
  };

  const deleteOrgName = deleteId ? orgs.find((o) => o.id === deleteId) : null;

  const openEditDialog = (org: Organisation) => {
    setEditOrg(org);
    const settings = org.settings as { description?: string } | null;
    setEditForm({ name: org.name, description: settings?.description ?? '' });
    setEditError('');
  };

  const handleEditSave = async () => {
    if (!editOrg) return;
    setEditError('');
    try {
      const existingSettings = (editOrg.settings as Record<string, unknown>) ?? {};
      await api.patch(`/api/organisations/${editOrg.id}`, {
        name: editForm.name,
        settings: { ...existingSettings, description: editForm.description },
      });
      setEditOrg(null);
      loadOrgs();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setEditError(e.response?.data?.error ?? 'Failed to update organisation');
    }
  };

  const loadOrgUsers = async (orgId: string) => {
    const { data } = await api.get('/api/users', { headers: { 'X-Organisation-Id': orgId } });
    setOrgUsers(data);
  };

  const openUsersDialog = async (org: Organisation) => {
    setUsersOrg(org);
    setUsersError('');
    setUsersSuccess('');
    setShowInviteForm(false);
    setRemoveUserId(null);
    setLoadingUsers(true);
    try {
      await loadOrgUsers(org.id);
    } catch {
      setUsersError('Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  };

  const closeUsersDialog = () => {
    setUsersOrg(null);
    setOrgUsers([]);
    setShowInviteForm(false);
    setRemoveUserId(null);
    setResetPasswordUserId(null);
    setResetPasswordValue('');
    setUsersError('');
    setUsersSuccess('');
  };

  const handleResetPassword = async () => {
    if (!resetPasswordUserId || !usersOrg) return;
    setUsersError('');
    setUsersSuccess('');
    try {
      const { data } = await api.post(`/api/system/users/${resetPasswordUserId}/reset-password`, { newPassword: resetPasswordValue });
      setUsersSuccess(`Password reset for ${data.email}`);
      setResetPasswordUserId(null);
      setResetPasswordValue('');
      await loadOrgUsers(usersOrg.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setUsersError(e.response?.data?.error ?? 'Failed to reset password');
    }
  };

  const handleInviteUser = async () => {
    if (!usersOrg) return;
    setUsersError('');
    setUsersSuccess('');
    try {
      await api.post('/api/users/invite', inviteForm, { headers: { 'X-Organisation-Id': usersOrg.id } });
      setUsersSuccess(`Invitation sent to ${inviteForm.email}`);
      setShowInviteForm(false);
      setInviteForm({ email: '', role: 'user', firstName: '', lastName: '' });
      await loadOrgUsers(usersOrg.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setUsersError(e.response?.data?.error ?? 'Failed to send invitation');
    }
  };

  const handleUpdateUserRole = async (userId: string, role: string) => {
    if (!usersOrg) return;
    setUsersError('');
    try {
      await api.patch(`/api/users/${userId}`, { role }, { headers: { 'X-Organisation-Id': usersOrg.id } });
      await loadOrgUsers(usersOrg.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setUsersError(e.response?.data?.error ?? 'Failed to update role');
    }
  };

  const handleUpdateUserStatus = async (userId: string, status: string) => {
    if (!usersOrg) return;
    setUsersError('');
    try {
      await api.patch(`/api/users/${userId}`, { status }, { headers: { 'X-Organisation-Id': usersOrg.id } });
      await loadOrgUsers(usersOrg.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setUsersError(e.response?.data?.error ?? 'Failed to update status');
    }
  };

  const handleRemoveUserConfirm = async () => {
    if (!removeUserId || !usersOrg) return;
    setUsersError('');
    try {
      await api.delete(`/api/users/${removeUserId}`, { headers: { 'X-Organisation-Id': usersOrg.id } });
      setRemoveUserId(null);
      await loadOrgUsers(usersOrg.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setUsersError(e.response?.data?.error ?? 'Failed to remove user');
      setRemoveUserId(null);
    }
  };

  const removeUserTarget = removeUserId ? orgUsers.find((u) => u.id === removeUserId) : null;

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <>
      {/* Page header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">Organisations</h1>
          <p className="text-slate-500 mt-2 mb-0">Manage all organisations on the platform</p>
        </div>
        <div className="flex gap-3">
          <Link
            to="/system/settings?tab=system-admins"
            className="px-5 py-2.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-[14px] font-medium no-underline hover:bg-slate-100 transition-colors"
          >
            System Admins
          </Link>
          <button
            onClick={() => { setShowCreateForm(true); setCreateError(''); }}
            className="btn btn-primary"
          >
            + Create organisation
          </button>
        </div>
      </div>

      {/* Create org modal */}
      {showCreateForm && (
        <Modal title="New organisation" onClose={() => setShowCreateForm(false)} maxWidth={600}>
          {createError && <div className="text-red-600 text-[13px] mb-3">{createError}</div>}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div><label className={labelCls}>Name *</label><input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>Slug *</label><input value={createForm.slug} onChange={(e) => setCreateForm({ ...createForm, slug: e.target.value })} className={inputCls} /></div>
            <div>
              <label className={labelCls}>Plan *</label>
              <select value={createForm.plan} onChange={(e) => setCreateForm({ ...createForm, plan: e.target.value })} className={inputCls}>
                {['starter', 'pro', 'agency'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Admin email *</label><input type="email" value={createForm.adminEmail} onChange={(e) => setCreateForm({ ...createForm, adminEmail: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>Admin first name *</label><input value={createForm.adminFirstName} onChange={(e) => setCreateForm({ ...createForm, adminFirstName: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>Admin last name *</label><input value={createForm.adminLastName} onChange={(e) => setCreateForm({ ...createForm, adminLastName: e.target.value })} className={inputCls} /></div>
          </div>
          {configTemplates.length > 0 && (
            <div className="mb-6">
              <label className={labelCls}>Configuration Template</label>
              <select value={createForm.configTemplateId} onChange={(e) => setCreateForm({ ...createForm, configTemplateId: e.target.value })} className={inputCls}>
                <option value="">None</option>
                {configTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <p className="text-[12px] text-slate-400 mt-1 m-0">Pre-configures the organisation with agents, skills, and operational settings.</p>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={handleCreate} className="btn btn-primary">Create</button>
            <button onClick={() => setShowCreateForm(false)} className="btn btn-secondary">Cancel</button>
          </div>
        </Modal>
      )}

      {/* Delete org confirm */}
      {deleteId && (
        <ConfirmDialog
          title="Delete organisation"
          message={`Are you sure you want to delete "${deleteOrgName?.name ?? 'this organisation'}"? This action cannot be undone and will remove all associated data.`}
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}

      {/* Edit org dialog */}
      {editOrg && (
        <Modal title={`Edit — ${editOrg.name}`} onClose={() => setEditOrg(null)} maxWidth={520}>
          {editError && <div className="text-red-600 text-[13px] mb-3">{editError}</div>}
          <div className="flex flex-col gap-3.5 mb-6">
            <div>
              <label className={labelCls}>Name *</label>
              <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={4}
                placeholder="Optional description for this organisation"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleEditSave} className="btn btn-primary">Save changes</button>
            <button onClick={() => setEditOrg(null)} className="btn btn-secondary">Cancel</button>
          </div>
        </Modal>
      )}

      {/* Users dialog */}
      {usersOrg && (
        <Modal title={`Users — ${usersOrg.name}`} onClose={closeUsersDialog} maxWidth={820}>
          {usersSuccess && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-3.5 py-2.5 mb-3.5 text-green-700 text-[13px]">
              {usersSuccess}
            </div>
          )}
          {usersError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5 mb-3.5 text-red-600 text-[13px]">
              {usersError}
            </div>
          )}

          {removeUserId && (
            <ConfirmDialog
              title="Remove user"
              message={`Remove ${removeUserTarget ? `${removeUserTarget.firstName} ${removeUserTarget.lastName} (${removeUserTarget.email})` : 'this user'} from the organisation? This action cannot be undone.`}
              confirmLabel="Remove"
              onConfirm={handleRemoveUserConfirm}
              onCancel={() => setRemoveUserId(null)}
            />
          )}

          {resetPasswordUserId && (
            <div className="bg-sky-50 border border-sky-200 rounded-lg p-4 mb-4">
              <h3 className="text-[14px] font-semibold text-sky-900 mb-2">
                Reset password for {orgUsers.find(u => u.id === resetPasswordUserId)?.email}
              </h3>
              <div className="mb-2.5">
                <label className={labelCls}>New password *</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={resetPasswordValue}
                    onChange={(e) => setResetPasswordValue(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className={`${inputCls} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
                      const specials = '!@#$%&*';
                      let pw = '';
                      for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)];
                      pw += specials[Math.floor(Math.random() * specials.length)];
                      pw += String(Math.floor(Math.random() * 10));
                      setResetPasswordValue(pw);
                    }}
                    className="px-3.5 py-2 bg-sky-100 hover:bg-sky-200 text-sky-700 border border-sky-300 rounded-lg text-[12px] font-medium cursor-pointer whitespace-nowrap transition-colors"
                  >
                    Generate
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleResetPassword}
                  disabled={resetPasswordValue.length < 8}
                  className="btn btn-sm btn-primary"
                >
                  Reset password
                </button>
                <button
                  onClick={() => { setResetPasswordUserId(null); setResetPasswordValue(''); }}
                  className="btn btn-sm btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {showInviteForm ? (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
              <h3 className="text-[14px] font-semibold text-slate-800 mb-3">Invite new user</h3>
              <div className="grid grid-cols-2 gap-2.5 mb-3">
                <div className="col-span-2">
                  <label className={labelCls}>Email *</label>
                  <input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>First name</label>
                  <input value={inviteForm.firstName} onChange={(e) => setInviteForm({ ...inviteForm, firstName: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Last name</label>
                  <input value={inviteForm.lastName} onChange={(e) => setInviteForm({ ...inviteForm, lastName: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Role *</label>
                  <select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })} className={inputCls}>
                    {ADMIN_ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleInviteUser} className="btn btn-sm btn-primary">Send invitation</button>
                <button
                  onClick={() => { setShowInviteForm(false); setInviteForm({ email: '', role: 'user', firstName: '', lastName: '' }); }}
                  className="btn btn-sm btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end mb-3">
              <button
                onClick={() => { setShowInviteForm(true); setUsersError(''); setUsersSuccess(''); }}
                className="btn btn-sm btn-primary"
              >
                + Invite user
              </button>
            </div>
          )}

          {loadingUsers ? (
            <div className="py-6 text-center text-slate-500 text-[14px]">Loading users...</div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3.5 py-2.5 text-left font-semibold text-slate-700">Name</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold text-slate-700">Email</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold text-slate-700">Role</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold text-slate-700">Status</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold text-slate-700">Last login</th>
                    <th className="px-3.5 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {orgUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-500">No users found</td>
                    </tr>
                  ) : orgUsers.map((u) => (
                    <tr key={u.id}>
                      <td className="px-3.5 py-2.5 font-medium text-slate-800">{u.firstName} {u.lastName}</td>
                      <td className="px-3.5 py-2.5 text-slate-500">{u.email}</td>
                      <td className="px-3.5 py-2.5">
                        {u.role === 'system_admin' ? (
                          <span className="text-violet-700 font-medium">{u.role}</span>
                        ) : (
                          <select
                            value={u.role}
                            onChange={(e) => handleUpdateUserRole(u.id, e.target.value)}
                            className="px-1.5 py-0.5 border border-slate-200 rounded-md text-[12px] bg-white"
                          >
                            {ADMIN_ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <select
                          value={u.status}
                          onChange={(e) => handleUpdateUserStatus(u.id, e.target.value)}
                          className={`px-1.5 py-0.5 border border-slate-200 rounded-md text-[12px] bg-white ${u.status === 'active' ? 'text-green-600' : u.status === 'inactive' ? 'text-slate-500' : 'text-amber-600'}`}
                        >
                          <option value="active">active</option>
                          <option value="inactive">inactive</option>
                          {u.status === 'pending' && <option value="pending">pending</option>}
                        </select>
                      </td>
                      <td className="px-3.5 py-2.5 text-slate-500 text-[12px]">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => { setResetPasswordUserId(u.id); setResetPasswordValue(''); setUsersError(''); setUsersSuccess(''); }}
                            className="btn btn-xs btn-ghost text-sky-700 hover:bg-sky-50"
                          >
                            Reset pw
                          </button>
                          <button
                            onClick={() => setRemoveUserId(u.id)}
                            className="btn btn-xs btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {/* Organisations table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Name</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Slug</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Plan</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Created</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {orgs.map((org) => (
              <tr key={org.id}>
                <td className="px-4 py-3 font-medium text-slate-800">{org.name}</td>
                <td className="px-4 py-3 text-slate-500 font-mono text-[13px]">{org.slug}</td>
                <td className="px-4 py-3">
                  <select value={org.plan} onChange={(e) => handleUpdatePlan(org.id, e.target.value)} className="px-2 py-1 border border-slate-200 rounded-md text-[13px] bg-white">
                    {['starter', 'pro', 'agency'].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={org.status}
                    onChange={(e) => handleUpdateStatus(org.id, e.target.value)}
                    className={`px-2 py-1 border border-slate-200 rounded-md text-[13px] bg-white ${org.status === 'active' ? 'text-green-600' : 'text-red-600'}`}
                  >
                    <option value="active">active</option>
                    <option value="suspended">suspended</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-slate-500 text-[13px]">{new Date(org.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => openUsersDialog(org)}
                      className="btn btn-xs btn-ghost text-green-700 hover:bg-green-50"
                    >
                      Users
                    </button>
                    <button
                      onClick={() => openEditDialog(org)}
                      className="btn btn-xs btn-ghost text-blue-700 hover:bg-blue-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteId(org.id)}
                      className="btn btn-xs btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
