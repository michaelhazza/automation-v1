import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface Subaccount {
  id: string;
  name: string;
  slug: string;
  status: string;
}

interface Category {
  id: string;
  name: string;
  description: string | null;
  colour: string | null;
}

interface TaskLink {
  linkId: string;
  taskId: string;
  taskName: string;
  taskStatus: string;
  isActive: boolean;
  subaccountCategoryId: string | null;
}

interface NativeTask {
  id: string;
  name: string;
  status: string;
}

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

interface OrgTask {
  id: string;
  name: string;
  status: string;
}

interface PermissionSet {
  id: string;
  name: string;
}

interface OrgMember {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}

type ActiveTab = 'categories' | 'tasks' | 'members' | 'settings';

export default function AdminSubaccountDetailPage({ user }: { user: User }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [sa, setSa] = useState<Subaccount | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [linkedTasks, setLinkedTasks] = useState<TaskLink[]>([]);
  const [nativeTasks, setNativeTasks] = useState<NativeTask[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [orgTasks, setOrgTasks] = useState<OrgTask[]>([]);
  const [permissionSets, setPermissionSets] = useState<PermissionSet[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('categories');
  const [error, setError] = useState('');

  // Category form
  const [showCatForm, setShowCatForm] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', description: '', colour: '#6366f1' });
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null);

  // Task link form
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkForm, setLinkForm] = useState({ taskId: '', subaccountCategoryId: '' });
  const [deleteLinkId, setDeleteLinkId] = useState<string | null>(null);

  // Member form
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [memberForm, setMemberForm] = useState({ userId: '', permissionSetId: '' });
  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);

  // Settings form
  const [settingsForm, setSettingsForm] = useState({ name: '', slug: '', status: 'active' });
  const [settingsSaved, setSettingsSaved] = useState('');

  const load = async () => {
    if (!subaccountId) return;
    try {
      const [saRes, catRes, taskRes, memberRes] = await Promise.all([
        api.get(`/api/subaccounts/${subaccountId}`),
        api.get(`/api/subaccounts/${subaccountId}/categories`),
        api.get(`/api/subaccounts/${subaccountId}/tasks`),
        api.get(`/api/subaccounts/${subaccountId}/members`),
      ]);
      setSa(saRes.data);
      setCategories(catRes.data);
      setLinkedTasks(taskRes.data.linkedTasks ?? []);
      setNativeTasks(taskRes.data.nativeTasks ?? []);
      setMembers(memberRes.data);
      setSettingsForm({ name: saRes.data.name, slug: saRes.data.slug, status: saRes.data.status });
    } finally {
      setLoading(false);
    }
  };

  const loadOrgData = async () => {
    const [psRes, tasksRes, membersRes] = await Promise.all([
      api.get('/api/permission-sets').catch(() => ({ data: [] })),
      api.get('/api/tasks').catch(() => ({ data: [] })),
      api.get('/api/org/members').catch(() => ({ data: [] })),
    ]);
    setPermissionSets(psRes.data);
    setOrgTasks(tasksRes.data.filter((t: OrgTask) => t.status === 'active'));
    setOrgMembers(membersRes.data);
  };

  useEffect(() => {
    load();
    loadOrgData();
  }, [subaccountId]);

  // ─── Categories ───────────────────────────────────────────────────────────

  const handleCreateCategory = async () => {
    setError('');
    try {
      await api.post(`/api/subaccounts/${subaccountId}/categories`, catForm);
      setShowCatForm(false);
      setCatForm({ name: '', description: '', colour: '#6366f1' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create category');
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCatId) return;
    await api.delete(`/api/subaccounts/${subaccountId}/categories/${deleteCatId}`);
    setDeleteCatId(null);
    load();
  };

  // ─── Task links ───────────────────────────────────────────────────────────

  const handleCreateLink = async () => {
    setError('');
    try {
      await api.post(`/api/subaccounts/${subaccountId}/tasks`, {
        taskId: linkForm.taskId,
        subaccountCategoryId: linkForm.subaccountCategoryId || undefined,
      });
      setShowLinkForm(false);
      setLinkForm({ taskId: '', subaccountCategoryId: '' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to link task');
    }
  };

  const handleDeleteLink = async () => {
    if (!deleteLinkId) return;
    await api.delete(`/api/subaccounts/${subaccountId}/tasks/${deleteLinkId}`);
    setDeleteLinkId(null);
    load();
  };

  const handleToggleLinkActive = async (link: TaskLink) => {
    await api.patch(`/api/subaccounts/${subaccountId}/tasks/${link.linkId}`, { isActive: !link.isActive });
    load();
  };

  // ─── Members ──────────────────────────────────────────────────────────────

  const handleAddMember = async () => {
    setError('');
    try {
      await api.post(`/api/subaccounts/${subaccountId}/members`, memberForm);
      setShowMemberForm(false);
      setMemberForm({ userId: '', permissionSetId: '' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to add member');
    }
  };

  const handleRemoveMember = async () => {
    if (!removeMemberId) return;
    await api.delete(`/api/subaccounts/${subaccountId}/members/${removeMemberId}`);
    setRemoveMemberId(null);
    load();
  };

  const handleUpdateMemberRole = async (userId: string, permissionSetId: string) => {
    await api.patch(`/api/subaccounts/${subaccountId}/members/${userId}`, { permissionSetId });
    load();
  };

  // ─── Settings ─────────────────────────────────────────────────────────────

  const handleSaveSettings = async () => {
    setError('');
    setSettingsSaved('');
    try {
      await api.patch(`/api/subaccounts/${subaccountId}`, settingsForm);
      setSettingsSaved('Saved successfully');
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to save settings');
    }
  };

  if (loading || !sa) return <div>Loading...</div>;

  const tabStyle = (tab: ActiveTab): React.CSSProperties => ({
    padding: '8px 16px',
    border: 'none',
    borderBottom: `2px solid ${activeTab === tab ? '#2563eb' : 'transparent'}`,
    background: 'transparent',
    color: activeTab === tab ? '#2563eb' : '#64748b',
    fontWeight: activeTab === tab ? 600 : 400,
    fontSize: 14,
    cursor: 'pointer',
  });

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Link to="/admin/subaccounts" style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none' }}>← Back to subaccounts</Link>
      </div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>{sa.name}</h1>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24, fontFamily: 'monospace' }}>{sa.slug}</div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #e2e8f0', marginBottom: 24, display: 'flex', gap: 4 }}>
        {(['categories', 'tasks', 'members', 'settings'] as ActiveTab[]).map((tab) => (
          <button key={tab} style={tabStyle(tab)} onClick={() => { setActiveTab(tab); setError(''); }}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {/* ─── Categories tab ─── */}
      {activeTab === 'categories' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: '#1e293b' }}>Portal categories</h2>
            <button onClick={() => setShowCatForm(true)} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>+ Add category</button>
          </div>

          {showCatForm && (
            <Modal title="New category" onClose={() => setShowCatForm(false)} maxWidth={400}>
              <div style={{ display: 'grid', gap: 14, marginBottom: 20 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Name *</label>
                  <input value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Description</label>
                  <input value={catForm.description} onChange={(e) => setCatForm({ ...catForm, description: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Colour</label>
                  <input type="color" value={catForm.colour} onChange={(e) => setCatForm({ ...catForm, colour: e.target.value })} style={{ height: 36, width: 60, padding: 2, border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={handleCreateCategory} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Create</button>
                <button onClick={() => setShowCatForm(false)} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              </div>
            </Modal>
          )}

          {deleteCatId && (
            <ConfirmDialog title="Delete category" message="Delete this category?" confirmLabel="Delete" onConfirm={handleDeleteCategory} onCancel={() => setDeleteCatId(null)} />
          )}

          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            {categories.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>No categories yet.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead><tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Name</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Description</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Actions</th>
                </tr></thead>
                <tbody>
                  {categories.map((cat) => (
                    <tr key={cat.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {cat.colour && <span style={{ width: 12, height: 12, borderRadius: '50%', background: cat.colour, flexShrink: 0 }} />}
                          <span style={{ fontWeight: 500 }}>{cat.name}</span>
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#64748b' }}>{cat.description ?? '-'}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <button onClick={() => setDeleteCatId(cat.id)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ─── Tasks tab ─── */}
      {activeTab === 'tasks' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: '#1e293b' }}>Linked org tasks</h2>
            <button onClick={() => setShowLinkForm(true)} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>+ Link task</button>
          </div>

          {showLinkForm && (
            <Modal title="Link task to subaccount" onClose={() => setShowLinkForm(false)} maxWidth={400}>
              <div style={{ display: 'grid', gap: 14, marginBottom: 20 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Org task *</label>
                  <select value={linkForm.taskId} onChange={(e) => setLinkForm({ ...linkForm, taskId: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}>
                    <option value="">Select task...</option>
                    {orgTasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Portal category (optional)</label>
                  <select value={linkForm.subaccountCategoryId} onChange={(e) => setLinkForm({ ...linkForm, subaccountCategoryId: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}>
                    <option value="">No category</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={handleCreateLink} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Link</button>
                <button onClick={() => setShowLinkForm(false)} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              </div>
            </Modal>
          )}

          {deleteLinkId && (
            <ConfirmDialog title="Remove task link" message="Remove this task from the subaccount?" confirmLabel="Remove" onConfirm={handleDeleteLink} onCancel={() => setDeleteLinkId(null)} />
          )}

          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 24 }}>
            {linkedTasks.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>No tasks linked yet.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead><tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Task</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Active in portal</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Actions</th>
                </tr></thead>
                <tbody>
                  {linkedTasks.map((link) => (
                    <tr key={link.linkId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 500 }}>{link.taskName}</td>
                      <td style={{ padding: '12px 16px', color: '#64748b' }}>{link.taskStatus}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <button onClick={() => handleToggleLinkActive(link)} style={{ padding: '3px 10px', background: link.isActive ? '#dcfce7' : '#f1f5f9', color: link.isActive ? '#16a34a' : '#6b7280', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                          {link.isActive ? 'Active' : 'Hidden'}
                        </button>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <button onClick={() => setDeleteLinkId(link.linkId)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {nativeTasks.length > 0 && (
            <>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 12 }}>Subaccount-native tasks</h3>
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead><tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Task</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Status</th>
                  </tr></thead>
                  <tbody>
                    {nativeTasks.map((t) => (
                      <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 500 }}>{t.name}</td>
                        <td style={{ padding: '12px 16px', color: '#64748b' }}>{t.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {/* ─── Members tab ─── */}
      {activeTab === 'members' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: '#1e293b' }}>Members</h2>
            <button onClick={() => setShowMemberForm(true)} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>+ Add member</button>
          </div>

          {showMemberForm && (
            <Modal title="Add member" onClose={() => setShowMemberForm(false)} maxWidth={400}>
              <div style={{ display: 'grid', gap: 14, marginBottom: 20 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>User *</label>
                  <select value={memberForm.userId} onChange={(e) => setMemberForm({ ...memberForm, userId: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}>
                    <option value="">Select user...</option>
                    {orgMembers.map((m) => <option key={m.userId} value={m.userId}>{m.firstName} {m.lastName} ({m.email})</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Permission set *</label>
                  <select value={memberForm.permissionSetId} onChange={(e) => setMemberForm({ ...memberForm, permissionSetId: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}>
                    <option value="">Select permission set...</option>
                    {permissionSets.map((ps) => <option key={ps.id} value={ps.id}>{ps.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={handleAddMember} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Add</button>
                <button onClick={() => setShowMemberForm(false)} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              </div>
            </Modal>
          )}

          {removeMemberId && (
            <ConfirmDialog title="Remove member" message="Remove this member's access to the subaccount?" confirmLabel="Remove" onConfirm={handleRemoveMember} onCancel={() => setRemoveMemberId(null)} />
          )}

          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            {members.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>No members yet.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead><tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>User</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Permission set</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Actions</th>
                </tr></thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.assignmentId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 500 }}>{m.firstName} {m.lastName}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>{m.email}</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <select
                          value={m.permissionSetId}
                          onChange={(e) => handleUpdateMemberRole(m.userId, e.target.value)}
                          style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
                        >
                          {permissionSets.map((ps) => <option key={ps.id} value={ps.id}>{ps.name}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <button onClick={() => setRemoveMemberId(m.userId)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ─── Settings tab ─── */}
      {activeTab === 'settings' && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 24, border: '1px solid #e2e8f0', maxWidth: 480 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 20px', color: '#1e293b' }}>Subaccount settings</h2>
          {settingsSaved && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#16a34a', fontSize: 13 }}>{settingsSaved}</div>}
          <div style={{ display: 'grid', gap: 16, marginBottom: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Name</label>
              <input value={settingsForm.name} onChange={(e) => setSettingsForm({ ...settingsForm, name: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Slug</label>
              <input value={settingsForm.slug} onChange={(e) => setSettingsForm({ ...settingsForm, slug: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Status</label>
              <select value={settingsForm.status} onChange={(e) => setSettingsForm({ ...settingsForm, status: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>
          <button onClick={handleSaveSettings} style={{ padding: '10px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Save changes</button>
        </div>
      )}
    </>
  );
}
