import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import BoardColumnEditor, { type BoardColumn } from '../components/BoardColumnEditor';

interface Subaccount { id: string; name: string; slug: string; status: string; }
interface Category { id: string; name: string; description: string | null; colour: string | null; }
interface ProcessLink { linkId: string; processId: string; processName: string; processStatus: string; isActive: boolean; subaccountCategoryId: string | null; }
interface NativeProcess { id: string; name: string; status: string; }
interface Member { assignmentId: string; userId: string; email: string; firstName: string; lastName: string; status: string; permissionSetId: string; permissionSetName: string; }
interface OrgProcess { id: string; name: string; status: string; }
interface PermissionSet { id: string; name: string; }
interface OrgMember { userId: string; email: string; firstName: string; lastName: string; }

type ActiveTab = 'board' | 'categories' | 'processes' | 'members' | 'settings';

const TAB_LABELS: Record<ActiveTab, string> = {
  board: 'Board Config', categories: 'Categories', processes: 'Automations',
  members: 'Members', settings: 'Settings',
};

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
const btnPrimary = 'px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors';
const btnSecondary = 'px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-medium rounded-lg transition-colors';

export default function AdminSubaccountDetailPage({ user: _user, mode = 'admin' }: { user: User; mode?: 'client' | 'admin' }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [sa, setSa] = useState<Subaccount | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [linkedProcesses, setLinkedProcesses] = useState<ProcessLink[]>([]);
  const [nativeProcesses, setNativeProcesses] = useState<NativeProcess[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [orgProcesses, setOrgProcesses] = useState<OrgProcess[]>([]);
  const [permissionSets, setPermissionSets] = useState<PermissionSet[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);

  const visibleTabs: ActiveTab[] = mode === 'client'
    ? ['board', 'categories', 'members']
    : ['processes', 'settings'];
  const [activeTab, setActiveTab] = useState<ActiveTab>(visibleTabs[0]);
  const [error, setError] = useState('');

  const [showCatForm, setShowCatForm] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', description: '', colour: '#6366f1' });
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null);

  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkForm, setLinkForm] = useState({ processId: '', subaccountCategoryId: '' });
  const [deleteLinkId, setDeleteLinkId] = useState<string | null>(null);

  const [showMemberForm, setShowMemberForm] = useState(false);
  const [memberForm, setMemberForm] = useState({ userId: '', permissionSetId: '' });
  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);

  const [settingsForm, setSettingsForm] = useState({ name: '', slug: '', status: 'active' });
  const [settingsSaved, setSettingsSaved] = useState('');

  const [boardColumns, setBoardColumns] = useState<BoardColumn[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardSaving, setBoardSaving] = useState(false);
  const [boardMsg, setBoardMsg] = useState('');

  const load = async () => {
    if (!subaccountId) return;
    try {
      const requests: Promise<any>[] = [
        api.get(`/api/subaccounts/${subaccountId}`),
        api.get(`/api/subaccounts/${subaccountId}/categories`),
        api.get(`/api/subaccounts/${subaccountId}/processes`),
        api.get(`/api/subaccounts/${subaccountId}/members`),
      ];
      if (mode === 'client') {
        requests.push(api.get(`/api/subaccounts/${subaccountId}/board-config`).catch(() => ({ data: null })));
      }
      const [saRes, catRes, processRes, memberRes, boardRes] = await Promise.all(requests);
      setSa(saRes.data);
      setCategories(catRes.data);
      setLinkedProcesses(processRes.data.linkedProcesses ?? []);
      setNativeProcesses(processRes.data.nativeProcesses ?? []);
      setMembers(memberRes.data);
      setSettingsForm({ name: saRes.data.name, slug: saRes.data.slug, status: saRes.data.status });
      if (boardRes?.data?.columns) setBoardColumns(boardRes.data.columns);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to load subaccount');
    } finally {
      setLoading(false);
    }
  };

  const loadOrgData = async () => {
    const [psRes, processesRes, membersRes] = await Promise.all([
      api.get('/api/permission-sets').catch(() => ({ data: [] })),
      api.get('/api/processes').catch(() => ({ data: [] })),
      api.get('/api/org/members').catch(() => ({ data: [] })),
    ]);
    setPermissionSets(psRes.data);
    setOrgProcesses(processesRes.data.filter((t: OrgProcess) => t.status === 'active'));
    setOrgMembers(membersRes.data);
  };

  useEffect(() => { load(); loadOrgData(); }, [subaccountId]);

  const handleCreateCategory = async () => {
    setError('');
    try {
      await api.post(`/api/subaccounts/${subaccountId}/categories`, catForm);
      setShowCatForm(false); setCatForm({ name: '', description: '', colour: '#6366f1' }); load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create category');
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCatId) return;
    await api.delete(`/api/subaccounts/${subaccountId}/categories/${deleteCatId}`);
    setDeleteCatId(null); load();
  };

  const handleCreateLink = async () => {
    setError('');
    try {
      await api.post(`/api/subaccounts/${subaccountId}/processes`, {
        processId: linkForm.processId,
        subaccountCategoryId: linkForm.subaccountCategoryId || undefined,
      });
      setShowLinkForm(false); setLinkForm({ processId: '', subaccountCategoryId: '' }); load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to link automation');
    }
  };

  const handleDeleteLink = async () => {
    if (!deleteLinkId) return;
    await api.delete(`/api/subaccounts/${subaccountId}/processes/${deleteLinkId}`);
    setDeleteLinkId(null); load();
  };

  const handleToggleLinkActive = async (link: ProcessLink) => {
    await api.patch(`/api/subaccounts/${subaccountId}/processes/${link.linkId}`, { isActive: !link.isActive });
    load();
  };

  const handleAddMember = async () => {
    setError('');
    try {
      await api.post(`/api/subaccounts/${subaccountId}/members`, memberForm);
      setShowMemberForm(false); setMemberForm({ userId: '', permissionSetId: '' }); load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to add member');
    }
  };

  const handleRemoveMember = async () => {
    if (!removeMemberId) return;
    await api.delete(`/api/subaccounts/${subaccountId}/members/${removeMemberId}`);
    setRemoveMemberId(null); load();
  };

  const handleUpdateMemberRole = async (userId: string, permissionSetId: string) => {
    await api.patch(`/api/subaccounts/${subaccountId}/members/${userId}`, { permissionSetId });
    load();
  };

  const handleSaveSettings = async () => {
    setError(''); setSettingsSaved('');
    try {
      await api.patch(`/api/subaccounts/${subaccountId}`, settingsForm);
      setSettingsSaved('Saved successfully'); load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to save settings');
    }
  };

  const handleSaveBoardConfig = async () => {
    setBoardSaving(true); setBoardMsg('');
    try {
      await api.patch(`/api/subaccounts/${subaccountId}/board-config`, { columns: boardColumns });
      setBoardMsg('Board configuration saved.');
      setTimeout(() => setBoardMsg(''), 3000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setBoardMsg(e.response?.data?.error ?? 'Failed to save board config');
    } finally { setBoardSaving(false); }
  };

  const handleResetFromOrg = async () => {
    setBoardSaving(true); setBoardMsg('');
    try {
      await api.post(`/api/subaccounts/${subaccountId}/board-config/push`);
      const { data } = await api.get(`/api/subaccounts/${subaccountId}/board-config`);
      if (data?.columns) setBoardColumns(data.columns);
      setBoardMsg('Board reset from organisation config.');
      setTimeout(() => setBoardMsg(''), 3000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setBoardMsg(e.response?.data?.error ?? 'Failed to reset board config');
    } finally { setBoardSaving(false); }
  };

  const handleInitBoard = async () => {
    setBoardLoading(true); setBoardMsg('');
    try {
      const { data } = await api.post(`/api/subaccounts/${subaccountId}/board-config/init`);
      if (data?.columns) setBoardColumns(data.columns);
      setBoardMsg('Board initialised from organisation config.');
      setTimeout(() => setBoardMsg(''), 3000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setBoardMsg(e.response?.data?.error ?? 'Failed to initialise board');
    } finally { setBoardLoading(false); }
  };

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  if (!sa) return <div className="p-8 text-sm text-red-600">{error || 'Subaccount not found'}</div>;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      {mode === 'admin' && (
        <div className="mb-4">
          <Link to="/admin/subaccounts" className="text-[13px] text-indigo-600 hover:text-indigo-700 no-underline">
            ← Back to subaccounts
          </Link>
        </div>
      )}

      <h1 className="text-[26px] font-bold text-slate-800 mb-1">
        {mode === 'client' ? `${sa.name} Settings` : sa.name}
      </h1>
      {mode === 'admin' && <div className="font-mono text-[13px] text-slate-400 mb-6">{sa.slug}</div>}
      {mode === 'client' && <div className="text-[13px] text-slate-500 mb-6">Manage categories, automations and members</div>}

      {/* Tabs */}
      {visibleTabs.length > 1 && (
        <div className="border-b border-slate-200 mb-6 flex gap-1">
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setError(''); }}
              className={`px-4 py-2 text-[14px] font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-indigo-600 text-indigo-600 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      )}

      {error && <div className="text-[13px] text-red-600 mb-4">{error}</div>}

      {/* Board Config */}
      {activeTab === 'board' && (
        <div>
          {boardColumns.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
              <p className="text-slate-500 text-sm mb-4">No board configuration yet. Initialise from the organisation board config.</p>
              {boardMsg && <div className={`text-[13px] mb-3 ${boardMsg.includes('Failed') ? 'text-red-500' : 'text-green-600'}`}>{boardMsg}</div>}
              <button onClick={handleInitBoard} disabled={boardLoading} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors">
                {boardLoading ? 'Initialising...' : 'Initialise from Org'}
              </button>
            </div>
          ) : (
            <>
              {boardMsg && <div className={`text-[13px] mb-3 ${boardMsg.includes('Failed') ? 'text-red-500' : 'text-green-600'}`}>{boardMsg}</div>}
              <BoardColumnEditor columns={boardColumns} onChange={setBoardColumns} />
              <div className="mt-5 flex gap-3">
                <button onClick={handleSaveBoardConfig} disabled={boardSaving} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors">
                  {boardSaving ? 'Saving...' : 'Save Changes'}
                </button>
                <button onClick={handleResetFromOrg} disabled={boardSaving} className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-sm font-medium rounded-lg transition-colors">
                  {boardSaving ? 'Resetting...' : 'Reset from Org'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Categories */}
      {activeTab === 'categories' && (
        <>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-[18px] font-semibold text-slate-800 m-0">Portal categories</h2>
            <button onClick={() => setShowCatForm(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors">
              + Add category
            </button>
          </div>

          {showCatForm && (
            <Modal title="New category" onClose={() => setShowCatForm(false)} maxWidth={400}>
              <div className="grid gap-3.5 mb-5">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name *</label>
                  <input value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description</label>
                  <input value={catForm.description} onChange={(e) => setCatForm({ ...catForm, description: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Colour</label>
                  <input type="color" value={catForm.colour} onChange={(e) => setCatForm({ ...catForm, colour: e.target.value })} className="h-9 w-14 p-0.5 border border-slate-200 rounded-md cursor-pointer" />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={handleCreateCategory} className={btnPrimary}>Create</button>
                <button onClick={() => setShowCatForm(false)} className={btnSecondary}>Cancel</button>
              </div>
            </Modal>
          )}

          {deleteCatId && (
            <ConfirmDialog title="Delete category" message="Delete this category?" confirmLabel="Delete" onConfirm={handleDeleteCategory} onCancel={() => setDeleteCatId(null)} />
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {categories.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">No categories yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Name</th>
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Description</th>
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {categories.map((cat) => (
                    <tr key={cat.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {cat.colour && <span className="w-3 h-3 rounded-full shrink-0" style={{ background: cat.colour }} />}
                          <span className="font-medium text-slate-800">{cat.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-[13px]">{cat.description ?? '—'}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => setDeleteCatId(cat.id)} className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-md text-xs font-medium transition-colors">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Processes */}
      {activeTab === 'processes' && (
        <>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-[18px] font-semibold text-slate-800 m-0">Linked org automations</h2>
            <button onClick={() => setShowLinkForm(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors">
              + Link automation
            </button>
          </div>

          {showLinkForm && (
            <Modal title="Link automation to client" onClose={() => setShowLinkForm(false)} maxWidth={400}>
              <div className="grid gap-3.5 mb-5">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Org automation *</label>
                  <select value={linkForm.processId} onChange={(e) => setLinkForm({ ...linkForm, processId: e.target.value })} className={inputCls}>
                    <option value="">Select automation...</option>
                    {orgProcesses.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Portal category (optional)</label>
                  <select value={linkForm.subaccountCategoryId} onChange={(e) => setLinkForm({ ...linkForm, subaccountCategoryId: e.target.value })} className={inputCls}>
                    <option value="">No category</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={handleCreateLink} className={btnPrimary}>Link</button>
                <button onClick={() => setShowLinkForm(false)} className={btnSecondary}>Cancel</button>
              </div>
            </Modal>
          )}

          {deleteLinkId && (
            <ConfirmDialog title="Remove automation link" message="Remove this automation from the client?" confirmLabel="Remove" onConfirm={handleDeleteLink} onCancel={() => setDeleteLinkId(null)} />
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6">
            {linkedProcesses.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">No automations linked yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Automation</th>
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Status</th>
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Active in portal</th>
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {linkedProcesses.map((link) => (
                    <tr key={link.linkId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{link.processName}</td>
                      <td className="px-4 py-3 text-[13px] text-slate-500">{link.processStatus}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleLinkActive(link)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${link.isActive ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                        >
                          {link.isActive ? 'Active' : 'Hidden'}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => setDeleteLinkId(link.linkId)} className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-md text-xs font-medium transition-colors">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {nativeProcesses.length > 0 && (
            <>
              <h3 className="text-[15px] font-semibold text-slate-700 mb-3">Client-native automations</h3>
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Automation</th>
                      <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {nativeProcesses.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{t.name}</td>
                        <td className="px-4 py-3 text-[13px] text-slate-500">{t.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {/* Members */}
      {activeTab === 'members' && (
        <>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-[18px] font-semibold text-slate-800 m-0">Members</h2>
            <button onClick={() => setShowMemberForm(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors">
              + Add member
            </button>
          </div>

          {showMemberForm && (
            <Modal title="Add member" onClose={() => setShowMemberForm(false)} maxWidth={400}>
              <div className="grid gap-3.5 mb-5">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">User *</label>
                  <select value={memberForm.userId} onChange={(e) => setMemberForm({ ...memberForm, userId: e.target.value })} className={inputCls}>
                    <option value="">Select user...</option>
                    {orgMembers.map((m) => <option key={m.userId} value={m.userId}>{m.firstName} {m.lastName} ({m.email})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Permission set *</label>
                  <select value={memberForm.permissionSetId} onChange={(e) => setMemberForm({ ...memberForm, permissionSetId: e.target.value })} className={inputCls}>
                    <option value="">Select permission set...</option>
                    {permissionSets.map((ps) => <option key={ps.id} value={ps.id}>{ps.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={handleAddMember} className={btnPrimary}>Add</button>
                <button onClick={() => setShowMemberForm(false)} className={btnSecondary}>Cancel</button>
              </div>
            </Modal>
          )}

          {removeMemberId && (
            <ConfirmDialog title="Remove member" message="Remove this member's access to the subaccount?" confirmLabel="Remove" onConfirm={handleRemoveMember} onCancel={() => setRemoveMemberId(null)} />
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {members.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">No members yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">User</th>
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Permission set</th>
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {members.map((m) => (
                    <tr key={m.assignmentId} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{m.firstName} {m.lastName}</div>
                        <div className="text-xs text-slate-500">{m.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={m.permissionSetId}
                          onChange={(e) => handleUpdateMemberRole(m.userId, e.target.value)}
                          className="px-2.5 py-1.5 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        >
                          {permissionSets.map((ps) => <option key={ps.id} value={ps.id}>{ps.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => setRemoveMemberId(m.userId)} className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-md text-xs font-medium transition-colors">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Settings */}
      {activeTab === 'settings' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-[480px]">
          <h2 className="text-[18px] font-semibold text-slate-800 mb-5">Subaccount settings</h2>
          {settingsSaved && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 mb-4 text-[13px] text-green-700">{settingsSaved}</div>
          )}
          <div className="grid gap-4 mb-5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name</label>
              <input value={settingsForm.name} onChange={(e) => setSettingsForm({ ...settingsForm, name: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Slug</label>
              <input value={settingsForm.slug} onChange={(e) => setSettingsForm({ ...settingsForm, slug: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Status</label>
              <select value={settingsForm.status} onChange={(e) => setSettingsForm({ ...settingsForm, status: e.target.value })} className={inputCls}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>
          <button onClick={handleSaveSettings} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors">
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}
