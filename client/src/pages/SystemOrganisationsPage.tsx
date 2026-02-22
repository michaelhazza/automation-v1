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

const STATUS_COLORS: Record<string, string> = {
  active: '#16a34a',
  inactive: '#6b7280',
  pending: '#d97706',
};

const ADMIN_ASSIGNABLE_ROLES = ['org_admin', 'manager', 'user', 'client_user'];

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 13,
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 6,
};

export default function SystemOrganisationsPage({ user: _user }: { user: User }) {
  // Org list
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Create org
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', slug: '', plan: 'starter', adminEmail: '', adminFirstName: '', adminLastName: '' });
  const [createError, setCreateError] = useState('');

  // Edit org
  const [editOrg, setEditOrg] = useState<Organisation | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [editError, setEditError] = useState('');

  // Users dialog
  const [usersOrg, setUsersOrg] = useState<Organisation | null>(null);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [usersSuccess, setUsersSuccess] = useState('');
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'user', firstName: '', lastName: '' });
  const [removeUserId, setRemoveUserId] = useState<string | null>(null);

  const loadOrgs = async () => {
    const { data } = await api.get('/api/organisations');
    setOrgs(data);
    setLoading(false);
  };

  useEffect(() => { loadOrgs(); }, []);

  // ── Create org ──────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    setCreateError('');
    try {
      await api.post('/api/organisations', createForm);
      setShowCreateForm(false);
      setCreateForm({ name: '', slug: '', plan: 'starter', adminEmail: '', adminFirstName: '', adminLastName: '' });
      loadOrgs();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setCreateError(e.response?.data?.error ?? 'Failed to create organisation');
    }
  };

  // ── Inline plan / status updates ────────────────────────────────────────────

  const handleUpdateStatus = async (id: string, status: string) => {
    await api.patch(`/api/organisations/${id}`, { status });
    loadOrgs();
  };

  const handleUpdatePlan = async (id: string, plan: string) => {
    await api.patch(`/api/organisations/${id}`, { plan });
    loadOrgs();
  };

  // ── Delete org ───────────────────────────────────────────────────────────────

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    await api.delete(`/api/organisations/${deleteId}`);
    setDeleteId(null);
    loadOrgs();
  };

  const deleteOrgName = deleteId ? orgs.find((o) => o.id === deleteId) : null;

  // ── Edit org dialog ──────────────────────────────────────────────────────────

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

  // ── Users dialog ─────────────────────────────────────────────────────────────

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
    setUsersError('');
    setUsersSuccess('');
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

  if (loading) return <div>Loading...</div>;

  return (
    <>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>Organisations</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>Manage all organisations on the platform</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link
            to="/system/users"
            style={{ padding: '10px 20px', background: '#f8fafc', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500, textDecoration: 'none', display: 'inline-block' }}
          >
            System Admins
          </Link>
          <button
            onClick={() => { setShowCreateForm(true); setCreateError(''); }}
            style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}
          >
            + Create organisation
          </button>
        </div>
      </div>

      {/* ── Create org modal ─────────────────────────────────────────────── */}
      {showCreateForm && (
        <Modal title="New organisation" onClose={() => setShowCreateForm(false)} maxWidth={600}>
          {createError && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{createError}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
            <div><label style={labelStyle}>Name *</label><input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} style={inputStyle} /></div>
            <div><label style={labelStyle}>Slug *</label><input value={createForm.slug} onChange={(e) => setCreateForm({ ...createForm, slug: e.target.value })} style={inputStyle} /></div>
            <div>
              <label style={labelStyle}>Plan *</label>
              <select value={createForm.plan} onChange={(e) => setCreateForm({ ...createForm, plan: e.target.value })} style={inputStyle}>
                {['starter', 'pro', 'agency'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div><label style={labelStyle}>Admin email *</label><input type="email" value={createForm.adminEmail} onChange={(e) => setCreateForm({ ...createForm, adminEmail: e.target.value })} style={inputStyle} /></div>
            <div><label style={labelStyle}>Admin first name *</label><input value={createForm.adminFirstName} onChange={(e) => setCreateForm({ ...createForm, adminFirstName: e.target.value })} style={inputStyle} /></div>
            <div><label style={labelStyle}>Admin last name *</label><input value={createForm.adminLastName} onChange={(e) => setCreateForm({ ...createForm, adminLastName: e.target.value })} style={inputStyle} /></div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleCreate} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>Create</button>
            <button onClick={() => setShowCreateForm(false)} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* ── Delete org confirm ───────────────────────────────────────────── */}
      {deleteId && (
        <ConfirmDialog
          title="Delete organisation"
          message={`Are you sure you want to delete "${deleteOrgName?.name ?? 'this organisation'}"? This action cannot be undone and will remove all associated data.`}
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}

      {/* ── Edit org dialog ──────────────────────────────────────────────── */}
      {editOrg && (
        <Modal title={`Edit — ${editOrg.name}`} onClose={() => setEditOrg(null)} maxWidth={520}>
          {editError && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{editError}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
            <div>
              <label style={labelStyle}>Name *</label>
              <input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Description</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={4}
                placeholder="Optional description for this organisation"
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleEditSave} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>Save changes</button>
            <button onClick={() => setEditOrg(null)} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* ── Users dialog ─────────────────────────────────────────────────── */}
      {usersOrg && (
        <Modal title={`Users — ${usersOrg.name}`} onClose={closeUsersDialog} maxWidth={820}>
          {usersSuccess && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginBottom: 14, color: '#16a34a', fontSize: 13 }}>
              {usersSuccess}
            </div>
          )}
          {usersError && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 14, color: '#dc2626', fontSize: 13 }}>
              {usersError}
            </div>
          )}

          {/* Remove user confirmation */}
          {removeUserId && (
            <ConfirmDialog
              title="Remove user"
              message={`Remove ${removeUserTarget ? `${removeUserTarget.firstName} ${removeUserTarget.lastName} (${removeUserTarget.email})` : 'this user'} from the organisation? This action cannot be undone.`}
              confirmLabel="Remove"
              onConfirm={handleRemoveUserConfirm}
              onCancel={() => setRemoveUserId(null)}
            />
          )}

          {/* Invite user form */}
          {showInviteForm ? (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px', color: '#1e293b' }}>Invite new user</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Email *</label>
                  <input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>First name</label>
                  <input value={inviteForm.firstName} onChange={(e) => setInviteForm({ ...inviteForm, firstName: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Last name</label>
                  <input value={inviteForm.lastName} onChange={(e) => setInviteForm({ ...inviteForm, lastName: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Role *</label>
                  <select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })} style={inputStyle}>
                    {ADMIN_ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleInviteUser} style={{ padding: '7px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>Send invitation</button>
                <button
                  onClick={() => { setShowInviteForm(false); setInviteForm({ email: '', role: 'user', firstName: '', lastName: '' }); }}
                  style={{ padding: '7px 16px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button
                onClick={() => { setShowInviteForm(true); setUsersError(''); setUsersSuccess(''); }}
                style={{ padding: '7px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
              >
                + Invite user
              </button>
            </div>
          )}

          {/* Users table */}
          {loadingUsers ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 14 }}>Loading users...</div>
          ) : (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Name</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Email</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Role</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Status</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Last login</th>
                    <th style={{ padding: '10px 14px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {orgUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No users found</td>
                    </tr>
                  ) : orgUsers.map((u) => (
                    <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 500, color: '#1e293b' }}>{u.firstName} {u.lastName}</td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>{u.email}</td>
                      <td style={{ padding: '10px 14px' }}>
                        {u.role === 'system_admin' ? (
                          <span style={{ color: '#7c3aed', fontWeight: 500 }}>{u.role}</span>
                        ) : (
                          <select
                            value={u.role}
                            onChange={(e) => handleUpdateUserRole(u.id, e.target.value)}
                            style={{ padding: '3px 7px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
                          >
                            {ADMIN_ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <select
                          value={u.status}
                          onChange={(e) => handleUpdateUserStatus(u.id, e.target.value)}
                          style={{ padding: '3px 7px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, color: STATUS_COLORS[u.status] ?? '#374151' }}
                        >
                          <option value="active">active</option>
                          <option value="inactive">inactive</option>
                          {u.status === 'pending' && <option value="pending">pending</option>}
                        </select>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b', fontSize: 12 }}>
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <button
                          onClick={() => setRemoveUserId(u.id)}
                          style={{ padding: '3px 8px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {/* ── Organisations table ───────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Name</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Slug</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Plan</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Status</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Created</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((org) => (
              <tr key={org.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px 16px', fontWeight: 500, color: '#1e293b' }}>{org.name}</td>
                <td style={{ padding: '12px 16px', color: '#64748b', fontFamily: 'monospace', fontSize: 13 }}>{org.slug}</td>
                <td style={{ padding: '12px 16px' }}>
                  <select value={org.plan} onChange={(e) => handleUpdatePlan(org.id, e.target.value)} style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
                    {['starter', 'pro', 'agency'].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <select value={org.status} onChange={(e) => handleUpdateStatus(org.id, e.target.value)} style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, color: org.status === 'active' ? '#16a34a' : '#dc2626' }}>
                    <option value="active">active</option>
                    <option value="suspended">suspended</option>
                  </select>
                </td>
                <td style={{ padding: '12px 16px', color: '#64748b', fontSize: 13 }}>{new Date(org.createdAt).toLocaleDateString()}</td>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => openUsersDialog(org)}
                      style={{ padding: '4px 10px', background: '#f0fdf4', color: '#16a34a', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                    >
                      Users
                    </button>
                    <button
                      onClick={() => openEditDialog(org)}
                      style={{ padding: '4px 10px', background: '#eff6ff', color: '#2563eb', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteId(org.id)}
                      style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
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
