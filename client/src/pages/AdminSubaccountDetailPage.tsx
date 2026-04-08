import { useEffect, useState, lazy, Suspense } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import BoardColumnEditor, { type BoardColumn } from '../components/BoardColumnEditor';

const WorkspaceMemoryPage = lazy(() => import('./WorkspaceMemoryPage'));
const UsagePage = lazy(() => import('./UsagePage'));
const ConnectionsPage = lazy(() => import('./ConnectionsPage'));
const AdminEnginesPage = lazy(() => import('./AdminEnginesPage'));

interface Subaccount { id: string; name: string; slug: string; status: string; includeInOrgInbox: boolean; }
interface Category { id: string; name: string; description: string | null; colour: string | null; }
interface ProcessLink { linkId: string; processId: string; processName: string; processStatus: string; isActive: boolean; subaccountCategoryId: string | null; }
interface OrgProcess { id: string; name: string; status: string; }
type ActiveTab = 'connections' | 'engines' | 'workflows' | 'agents' | 'categories' | 'board' | 'memory' | 'usage' | 'admin';

const TAB_LABELS: Record<ActiveTab, string> = {
  connections: 'Connections', engines: 'Engines', workflows: 'Workflows', agents: 'Agents',
  categories: 'Categories', board: 'Board Config', memory: 'Memory', usage: 'Usage & Costs', admin: 'Admin',
};

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
const btnPrimary = 'px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors';
const btnSecondary = 'px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-medium rounded-lg transition-colors';

export default function AdminSubaccountDetailPage({ user: _user, mode = 'admin' }: { user: User; mode?: 'client' | 'admin' }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [sa, setSa] = useState<Subaccount | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [linkedProcesses, setLinkedProcesses] = useState<ProcessLink[]>([]);
  const [orgProcesses, setOrgProcesses] = useState<OrgProcess[]>([]);
  const [loading, setLoading] = useState(true);

  const visibleTabs: ActiveTab[] = mode === 'client'
    ? ['connections', 'board', 'categories']
    : ['connections', 'engines', 'workflows', 'agents', 'categories', 'board', 'memory', 'usage', 'admin'];
  const [activeTab, setActiveTab] = useState<ActiveTab>(visibleTabs[0]);
  const [error, setError] = useState('');

  const [showCatForm, setShowCatForm] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', description: '', colour: '#6366f1' });
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null);

  // Workflow linking state
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkForm, setLinkForm] = useState({ processId: '', subaccountCategoryId: '' });
  const [deleteLinkId, setDeleteLinkId] = useState<string | null>(null);

  const [settingsForm, setSettingsForm] = useState({ name: '', slug: '', status: 'active', timezone: 'UTC', includeInOrgInbox: true });
  const [settingsSaved, setSettingsSaved] = useState('');

  const [boardColumns, setBoardColumns] = useState<BoardColumn[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardSaving, setBoardSaving] = useState(false);
  const [boardMsg, setBoardMsg] = useState('');

  const load = async () => {
    if (!subaccountId) return;
    try {
      const [saRes, catRes, processRes, boardRes] = await Promise.all([
        api.get(`/api/subaccounts/${subaccountId}`),
        api.get(`/api/subaccounts/${subaccountId}/categories`),
        api.get(`/api/subaccounts/${subaccountId}/processes`).catch((err) => { console.error('[AdminSubaccountDetail] Failed to fetch processes:', err); return { data: { linkedProcesses: [] } }; }),
        api.get(`/api/subaccounts/${subaccountId}/board-config`).catch((err: { response?: { status?: number } }) => { if (err?.response?.status !== 404) console.error('[AdminSubaccountDetail] Failed to fetch board config:', err); return { data: null }; }),
      ]);
      setSa(saRes.data);
      setCategories(catRes.data);
      setLinkedProcesses(processRes.data.linkedProcesses ?? []);
      setSettingsForm({ name: saRes.data.name, slug: saRes.data.slug, status: saRes.data.status, timezone: saRes.data.settings?.timezone ?? 'UTC', includeInOrgInbox: saRes.data.includeInOrgInbox ?? true });
      if (boardRes?.data?.columns) setBoardColumns(boardRes.data.columns);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to load subaccount');
    } finally {
      setLoading(false);
    }
  };

  const loadOrgData = async () => {
    const [processesRes] = await Promise.all([
      api.get('/api/processes').catch((err) => { console.error('[AdminSubaccountDetail] Failed to fetch processes:', err); return { data: [] }; }),
    ]);
    setOrgProcesses((processesRes.data as OrgProcess[]).filter(t => t.status === 'active'));
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

  // ── Workflow link handlers ──────────────────────────────────────────────────

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
      setError(e.response?.data?.error ?? 'Failed to link workflow');
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

  const handleDeleteCategory = async () => {
    if (!deleteCatId) return;
    await api.delete(`/api/subaccounts/${subaccountId}/categories/${deleteCatId}`);
    setDeleteCatId(null); load();
  };

  const handleSaveSettings = async () => {
    setError(''); setSettingsSaved('');
    try {
      const { timezone, includeInOrgInbox, ...rest } = settingsForm;
      await api.patch(`/api/subaccounts/${subaccountId}`, { ...rest, includeInOrgInbox, settings: { timezone } });
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
            ← Back to companies
          </Link>
        </div>
      )}

      <h1 className="text-[26px] font-bold text-slate-800 mb-1">
        {mode === 'client' ? `${sa.name} Settings` : sa.name}
      </h1>
      {mode === 'admin' && <div className="font-mono text-[13px] text-slate-400 mb-6">{sa.slug}</div>}
      {mode === 'client' && <div className="text-[13px] text-slate-500 mb-6">Manage connections, board config, and categories</div>}

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

      {/* Workflows */}
      {activeTab === 'workflows' && (
        <>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-[18px] font-semibold text-slate-800 m-0">Linked workflows</h2>
            <button onClick={() => setShowLinkForm(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors">
              + Link workflow
            </button>
          </div>

          {showLinkForm && (
            <Modal title="Link workflow to company" onClose={() => setShowLinkForm(false)} maxWidth={400}>
              <div className="grid gap-3.5 mb-5">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Org workflow *</label>
                  <select value={linkForm.processId} onChange={(e) => setLinkForm({ ...linkForm, processId: e.target.value })} className={inputCls}>
                    <option value="">Select workflow...</option>
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
            <ConfirmDialog title="Remove workflow link" message="Remove this workflow from the company?" confirmLabel="Remove" onConfirm={handleDeleteLink} onCancel={() => setDeleteLinkId(null)} />
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {linkedProcesses.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">No workflows linked yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Workflow</th>
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Status</th>
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Active in portal</th>
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {linkedProcesses.map((link) => (
                    <tr key={link.linkId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{link.processName}</td>
                      <td className="px-4 py-3 text-[13px] text-slate-500 capitalize">{link.processStatus}</td>
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
        </>
      )}

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

      {/* Connections */}
      {activeTab === 'connections' && (
        <Suspense fallback={<div className="py-8 text-sm text-slate-500">Loading connections...</div>}>
          <ConnectionsPage user={_user as any} embedded />
        </Suspense>
      )}

      {/* Engines */}
      {activeTab === 'engines' && (
        <Suspense fallback={<div className="py-8 text-sm text-slate-500">Loading engines...</div>}>
          <AdminEnginesPage user={_user as any} embedded />
        </Suspense>
      )}

      {/* Agents — link/unlink org agents + load team templates */}
      {activeTab === 'agents' && subaccountId && (
        <AgentsTab subaccountId={subaccountId} />
      )}

      {/* Admin */}
      {activeTab === 'admin' && subaccountId && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-[480px]">
            <h2 className="text-[18px] font-semibold text-slate-800 mb-5">Company settings</h2>
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
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Timezone</label>
                <p className="text-[12px] text-slate-400 mb-1.5">Agent heartbeat schedules run in this timezone.</p>
                <select value={settingsForm.timezone} onChange={(e) => setSettingsForm({ ...settingsForm, timezone: e.target.value })} className={inputCls}>
                  {[
                    'UTC',
                    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
                    'America/Toronto', 'America/Vancouver', 'America/Sao_Paulo',
                    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Amsterdam',
                    'Europe/Stockholm', 'Europe/Warsaw', 'Europe/Istanbul',
                    'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Shanghai',
                    'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland',
                  ].map((tz) => (
                    <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settingsForm.includeInOrgInbox}
                    onClick={() => setSettingsForm({ ...settingsForm, includeInOrgInbox: !settingsForm.includeInOrgInbox })}
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${settingsForm.includeInOrgInbox ? 'bg-indigo-600' : 'bg-slate-200'}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settingsForm.includeInOrgInbox ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                  <span className="text-[13px] font-medium text-slate-700">Include in Organisation Inbox</span>
                </label>
                <p className="text-[12px] text-slate-400 mt-1.5 ml-14">When enabled, inbox items from this subaccount (tasks, reviews, failed runs) will appear in the org-wide inbox. When disabled, they are only visible in this subaccount's inbox.</p>
              </div>
            </div>
            <button onClick={handleSaveSettings} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors">
              Save changes
            </button>
          </div>

          {/* Dev Execution Context */}
          <DevContextConfig subaccountId={subaccountId} />
        </div>
      )}

      {/* Memory */}
      {activeTab === 'memory' && (
        <Suspense fallback={<div className="py-8 text-sm text-slate-500">Loading memory...</div>}>
          <WorkspaceMemoryPage user={_user as any} embedded />
        </Suspense>
      )}

      {/* Usage & Costs */}
      {activeTab === 'usage' && (
        <Suspense fallback={<div className="py-8 text-sm text-slate-500">Loading usage data...</div>}>
          <UsagePage user={_user as any} embedded />
        </Suspense>
      )}
    </div>
  );
}

// ─── Agents Tab ──────────────────────────────────────────────────────────────

interface OrgAgent { id: string; name: string; slug: string; icon: string | null; status: string; description: string | null; }
interface LinkedAgent { id: string; agentId: string; isActive: boolean; agent: { name: string; icon: string | null; status: string; description: string | null; }; agentRole: string | null; }
interface Template { id: string; name: string; description: string | null; sourceType: string; slotCount: number; version: number; }
interface AgentRunRecord { id: string; status: string; runType: string; executionMode: string; summary: string | null; totalToolCalls: number; totalTokens: number; durationMs: number | null; errorMessage: string | null; createdAt: string; }

function AgentsTab({ subaccountId }: { subaccountId: string }) {
  const [linked, setLinked] = useState<LinkedAgent[]>([]);
  const [orgAgents, setOrgAgents] = useState<OrgAgent[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [applyingTemplate, setApplyingTemplate] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Run state
  const [runningAgentId, setRunningAgentId] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<Record<string, AgentRunRecord[]>>({});
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [showRunResult, setShowRunResult] = useState<AgentRunRecord | null>(null);
  const [claudeCodeAvailable, setClaudeCodeAvailable] = useState<boolean | null>(null);

  const load = async () => {
    try {
      const [linkedRes, agentsRes, templatesRes, ccStatus] = await Promise.all([
        api.get(`/api/subaccounts/${subaccountId}/agents`),
        api.get('/api/agents').catch(() => ({ data: [] })),
        api.get('/api/hierarchy-templates').catch(() => ({ data: [] })),
        api.get(`/api/subaccounts/${subaccountId}/claude-code-status`).catch(() => ({ data: { available: false } })),
      ]);
      setLinked(linkedRes.data);
      setOrgAgents(agentsRes.data);
      setTemplates(templatesRes.data);
      setClaudeCodeAvailable(ccStatus.data.available);
    } catch { setError('Failed to load agents'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [subaccountId]);

  const linkedIds = new Set(linked.map(l => l.agentId));
  const availableAgents = orgAgents.filter(a => !linkedIds.has(a.id) && a.status === 'active');

  const handleLink = async () => {
    if (!selectedAgentId) return;
    setError(''); setMsg('');
    try {
      await api.post(`/api/subaccounts/${subaccountId}/agents`, { agentId: selectedAgentId });
      setShowLinkForm(false); setSelectedAgentId('');
      setMsg('Agent linked successfully');
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to link agent');
    }
  };

  const handleUnlink = async (agentId: string) => {
    if (!confirm('Unlink this agent from this company?')) return;
    setError(''); setMsg('');
    try {
      await api.delete(`/api/subaccounts/${subaccountId}/agents/${agentId}`);
      setMsg('Agent unlinked');
      load();
    } catch { setError('Failed to unlink agent'); }
  };

  const handleApplyTemplate = async (templateId: string) => {
    setApplyingTemplate(templateId);
    setError(''); setMsg('');
    try {
      const { data } = await api.post(`/api/hierarchy-templates/${templateId}/apply`, {
        subaccountId,
        mode: 'merge',
      });
      const s = data.summary;
      setMsg(`Template applied: ${s.agentsLinked} linked, ${s.agentsCreated} created, ${s.hierarchyUpdated} hierarchy relationships set`);
      setShowTemplates(false);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to apply template');
    } finally { setApplyingTemplate(null); }
  };

  const handleRunAgent = async (agentId: string, mode: 'api' | 'claude-code') => {
    setRunningAgentId(agentId);
    setError(''); setMsg('');
    try {
      const { data } = await api.post(`/api/subaccounts/${subaccountId}/agents/${agentId}/run`, {
        executionMode: mode,
      });
      setMsg(`Agent run ${data.status}: ${data.summary?.slice(0, 200) ?? 'No summary'} (${data.totalTokens} tokens, ${Math.round((data.durationMs ?? 0) / 1000)}s)`);
      // Refresh history for this agent
      loadRunHistory(agentId);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to run agent');
    } finally { setRunningAgentId(null); }
  };

  const loadRunHistory = async (agentId: string) => {
    try {
      const { data } = await api.get(`/api/subaccounts/${subaccountId}/agents/${agentId}/runs?limit=10`);
      setRunHistory(prev => ({ ...prev, [agentId]: data }));
    } catch { /* ignore */ }
  };

  const toggleExpand = (agentId: string) => {
    if (expandedAgent === agentId) {
      setExpandedAgent(null);
    } else {
      setExpandedAgent(agentId);
      if (!runHistory[agentId]) loadRunHistory(agentId);
    }
  };

  const STATUS_BADGE: Record<string, string> = {
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    running: 'bg-blue-100 text-blue-700',
    timeout: 'bg-amber-100 text-amber-700',
    budget_exceeded: 'bg-orange-100 text-orange-700',
    loop_detected: 'bg-purple-100 text-purple-700',
    pending: 'bg-slate-100 text-slate-600',
    cancelled: 'bg-slate-100 text-slate-500',
  };

  if (loading) return <div className="py-8 text-sm text-slate-500">Loading agents...</div>;

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-[18px] font-semibold text-slate-800 m-0">Linked Agents</h2>
          {claudeCodeAvailable !== null && (
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${claudeCodeAvailable ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
              Claude Code {claudeCodeAvailable ? 'Available' : 'Not Found'}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowTemplates(true)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-medium rounded-lg transition-colors">
            Load Team Template
          </button>
          <button onClick={() => setShowLinkForm(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors">
            + Link Agent
          </button>
        </div>
      </div>

      {msg && <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 mb-4 text-[13px] text-green-700">{msg}</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 mb-4 text-[13px] text-red-600">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {linked.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">No agents linked yet. Link an org agent or load a team template to get started.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {linked.map((l) => (
              <div key={l.id}>
                <div className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {l.agent.icon && <span className="text-lg shrink-0">{l.agent.icon}</span>}
                    <div className="min-w-0">
                      <Link to={`/admin/subaccounts/${subaccountId}/agents/${l.id}/manage`} className="font-medium text-slate-800 hover:text-indigo-600 no-underline transition-colors text-[14px]">{l.agent.name}</Link>
                      {l.agent.description && <div className="text-[12px] text-slate-400 mt-0.5 truncate">{l.agent.description}</div>}
                    </div>
                    {l.agentRole && <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full shrink-0">{l.agentRole}</span>}
                    <span className={`text-[11px] font-semibold capitalize px-2 py-0.5 rounded-full shrink-0 ${l.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                      {l.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <Link
                      to={`/admin/subaccounts/${subaccountId}/agents/${l.id}/manage`}
                      className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-md text-[12px] font-medium transition-colors no-underline"
                    >
                      Manage
                    </Link>
                    <button
                      onClick={() => handleRunAgent(l.agentId, 'api')}
                      disabled={runningAgentId === l.agentId}
                      className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 disabled:opacity-50 rounded-md text-[12px] font-medium transition-colors"
                      title="Run via Anthropic API"
                    >
                      {runningAgentId === l.agentId ? 'Running...' : 'Run (API)'}
                    </button>
                    {claudeCodeAvailable && (
                      <button
                        onClick={() => handleRunAgent(l.agentId, 'claude-code')}
                        disabled={runningAgentId === l.agentId}
                        className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 disabled:opacity-50 rounded-md text-[12px] font-medium transition-colors"
                        title="Run via Claude Code CLI (uses Max plan)"
                      >
                        {runningAgentId === l.agentId ? 'Running...' : 'Run (Claude Code)'}
                      </button>
                    )}
                    <button
                      onClick={() => toggleExpand(l.agentId)}
                      className="px-2 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-md text-[12px] transition-colors"
                    >
                      {expandedAgent === l.agentId ? 'Hide' : 'History'}
                    </button>
                    <button onClick={() => handleUnlink(l.agentId)} className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-md text-[12px] font-medium transition-colors">
                      Unlink
                    </button>
                  </div>
                </div>

                {/* Expandable run history */}
                {expandedAgent === l.agentId && (
                  <div className="bg-slate-50 border-t border-slate-100 px-4 py-3">
                    <div className="text-[12px] font-semibold text-slate-600 mb-2">Recent Runs</div>
                    {!runHistory[l.agentId] ? (
                      <div className="text-[12px] text-slate-400">Loading...</div>
                    ) : runHistory[l.agentId].length === 0 ? (
                      <div className="text-[12px] text-slate-400">No runs yet</div>
                    ) : (
                      <div className="space-y-1.5">
                        {runHistory[l.agentId].map((r) => (
                          <div
                            key={r.id}
                            onClick={() => setShowRunResult(r)}
                            className="flex items-center gap-3 p-2 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-indigo-200 transition-colors"
                          >
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[r.status] ?? 'bg-slate-100 text-slate-500'}`}>
                              {r.status}
                            </span>
                            <span className="text-[11px] text-slate-500">{r.executionMode === 'claude-code' ? 'Claude Code' : 'API'}</span>
                            <span className="text-[12px] text-slate-700 truncate flex-1">{r.summary?.slice(0, 100) ?? r.errorMessage?.slice(0, 100) ?? 'No summary'}</span>
                            <span className="text-[11px] text-slate-400 shrink-0">
                              {r.totalTokens > 0 && `${r.totalTokens} tok`}
                              {r.durationMs && ` · ${Math.round(r.durationMs / 1000)}s`}
                            </span>
                            <span className="text-[11px] text-slate-400 shrink-0">{new Date(r.createdAt).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Run result detail modal */}
      {showRunResult && (
        <Modal title={`Run: ${showRunResult.status}`} onClose={() => setShowRunResult(null)} maxWidth={640}>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-[20px] font-bold text-slate-800">{showRunResult.totalTokens.toLocaleString()}</div>
              <div className="text-[11px] text-slate-500">Tokens</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-[20px] font-bold text-slate-800">{showRunResult.totalToolCalls}</div>
              <div className="text-[11px] text-slate-500">Tool Calls</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-[20px] font-bold text-slate-800">{showRunResult.durationMs ? `${Math.round(showRunResult.durationMs / 1000)}s` : '—'}</div>
              <div className="text-[11px] text-slate-500">Duration</div>
            </div>
          </div>
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[showRunResult.status] ?? 'bg-slate-100 text-slate-500'}`}>
                {showRunResult.status}
              </span>
              <span className="text-[11px] text-slate-500">{showRunResult.executionMode === 'claude-code' ? 'Claude Code' : 'API'} · {showRunResult.runType}</span>
              <span className="text-[11px] text-slate-400">{new Date(showRunResult.createdAt).toLocaleString()}</span>
            </div>
          </div>
          {showRunResult.summary && (
            <div className="mb-3">
              <div className="text-[12px] font-semibold text-slate-600 mb-1">Summary</div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[13px] text-slate-700 whitespace-pre-wrap max-h-[300px] overflow-auto">{showRunResult.summary}</div>
            </div>
          )}
          {showRunResult.errorMessage && (
            <div>
              <div className="text-[12px] font-semibold text-red-600 mb-1">Error</div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-[13px] text-red-700 whitespace-pre-wrap">{showRunResult.errorMessage}</div>
            </div>
          )}
        </Modal>
      )}

      {/* Link Agent modal */}
      {showLinkForm && (
        <Modal title="Link Org Agent" onClose={() => setShowLinkForm(false)} maxWidth={400}>
          {availableAgents.length === 0 ? (
            <div className="text-[13px] text-slate-500 mb-4">All org agents are already linked to this company, or no agents exist at the org level yet.</div>
          ) : (
            <div className="mb-5">
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Select agent</label>
              <select value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)} className={inputCls}>
                <option value="">Choose an agent...</option>
                {availableAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.icon ?? ''} {a.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-3">
            {availableAgents.length > 0 && <button onClick={handleLink} disabled={!selectedAgentId} className={btnPrimary}>Link</button>}
            <button onClick={() => setShowLinkForm(false)} className={btnSecondary}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* Team Templates modal */}
      {showTemplates && (
        <Modal title="Load Team Template" onClose={() => setShowTemplates(false)} maxWidth={500}>
          {templates.length === 0 ? (
            <div className="text-[13px] text-slate-500 mb-4">No team templates available. Create templates from the organisation Agents page.</div>
          ) : (
            <div className="flex flex-col gap-2 mb-4">
              {templates.map((t) => (
                <div key={t.id} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div>
                    <div className="text-[14px] font-semibold text-slate-800">{t.name}</div>
                    <div className="text-[12px] text-slate-500">{t.slotCount} agents &middot; v{t.version} &middot; {t.sourceType}</div>
                    {t.description && <div className="text-[12px] text-slate-400 mt-0.5">{t.description}</div>}
                  </div>
                  <button
                    onClick={() => handleApplyTemplate(t.id)}
                    disabled={applyingTemplate === t.id}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[12px] font-semibold rounded-lg transition-colors shrink-0"
                  >
                    {applyingTemplate === t.id ? 'Applying...' : 'Apply'}
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={() => setShowTemplates(false)} className={btnSecondary}>Close</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ─── Dev Execution Context Config ─────────────────────────────────────────────

function DevContextConfig({ subaccountId }: { subaccountId: string }) {
  const [dec, setDec] = useState({
    projectRoot: '',
    testCommand: '',
    buildCommand: '',
    lintCommand: '',
    runtime: 'node@20',
    packageManager: 'npm',
    gitConfig: { defaultBranch: 'main', branchPrefix: 'agent/', remote: 'origin', repoOwner: '', repoName: '' },
    costLimits: { maxTestRunsPerTask: 5, maxCommandsPerRun: 10, maxPatchAttemptsPerTask: 10 },
    resourceLimits: { commandTimeoutMs: 60000, maxOutputBytes: 1048576 },
    safeMode: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/api/subaccounts/${subaccountId}/dev-context`)
      .then(({ data }) => {
        if (data.devContext) {
          setDec(prev => ({
            ...prev,
            ...data.devContext,
            gitConfig: { ...prev.gitConfig, ...(data.devContext.gitConfig ?? {}) },
            costLimits: { ...prev.costLimits, ...(data.devContext.costLimits ?? {}) },
            resourceLimits: { ...prev.resourceLimits, ...(data.devContext.resourceLimits ?? {}) },
          }));
        }
      })
      .catch(() => { /* no DEC yet — that's fine */ })
      .finally(() => setLoading(false));
  }, [subaccountId]);

  const handleSave = async () => {
    setSaving(true); setMsg(''); setError('');
    try {
      await api.put(`/api/subaccounts/${subaccountId}/dev-context`, { devContext: dec });
      setMsg('Dev Execution Context saved');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to save');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="py-4 text-sm text-slate-500">Loading dev context...</div>;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="text-[18px] font-semibold text-slate-800 mb-1">Dev Execution Context</h2>
      <p className="text-[13px] text-slate-500 mt-0 mb-5">Configure how agents interact with this project's codebase, run tests, and execute commands.</p>

      {msg && <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 mb-4 text-[13px] text-green-700">{msg}</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 mb-4 text-[13px] text-red-600">{error}</div>}

      <div className="space-y-5">
        {/* Project basics */}
        <div>
          <h3 className="text-[14px] font-semibold text-slate-700 mb-3">Project</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Project Root *</label>
              <input value={dec.projectRoot} onChange={(e) => setDec({ ...dec, projectRoot: e.target.value })} placeholder="/home/user/my-project" className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Runtime</label>
              <input value={dec.runtime} onChange={(e) => setDec({ ...dec, runtime: e.target.value })} placeholder="node@20" className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Package Manager</label>
              <select value={dec.packageManager} onChange={(e) => setDec({ ...dec, packageManager: e.target.value })} className={inputCls}>
                <option value="npm">npm</option>
                <option value="yarn">yarn</option>
                <option value="pnpm">pnpm</option>
                <option value="bun">bun</option>
              </select>
            </div>
          </div>
        </div>

        {/* Commands */}
        <div>
          <h3 className="text-[14px] font-semibold text-slate-700 mb-3">Commands</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Test Command *</label>
              <input value={dec.testCommand} onChange={(e) => setDec({ ...dec, testCommand: e.target.value })} placeholder="npm test" className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Build Command</label>
              <input value={dec.buildCommand} onChange={(e) => setDec({ ...dec, buildCommand: e.target.value })} placeholder="npm run build" className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Lint Command</label>
              <input value={dec.lintCommand} onChange={(e) => setDec({ ...dec, lintCommand: e.target.value })} placeholder="npm run lint" className={inputCls} />
            </div>
          </div>
        </div>

        {/* Git config */}
        <div>
          <h3 className="text-[14px] font-semibold text-slate-700 mb-3">Git</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Default Branch</label>
              <input value={dec.gitConfig.defaultBranch} onChange={(e) => setDec({ ...dec, gitConfig: { ...dec.gitConfig, defaultBranch: e.target.value } })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Repo Owner</label>
              <input value={dec.gitConfig.repoOwner} onChange={(e) => setDec({ ...dec, gitConfig: { ...dec.gitConfig, repoOwner: e.target.value } })} placeholder="github-username" className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Repo Name</label>
              <input value={dec.gitConfig.repoName} onChange={(e) => setDec({ ...dec, gitConfig: { ...dec.gitConfig, repoName: e.target.value } })} placeholder="my-repo" className={inputCls} />
            </div>
          </div>
        </div>

        {/* Limits */}
        <div>
          <h3 className="text-[14px] font-semibold text-slate-700 mb-3">Limits</h3>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Max Test Runs / Task</label>
              <input type="number" value={dec.costLimits.maxTestRunsPerTask} onChange={(e) => setDec({ ...dec, costLimits: { ...dec.costLimits, maxTestRunsPerTask: Number(e.target.value) } })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Max Commands / Run</label>
              <input type="number" value={dec.costLimits.maxCommandsPerRun} onChange={(e) => setDec({ ...dec, costLimits: { ...dec.costLimits, maxCommandsPerRun: Number(e.target.value) } })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Command Timeout (ms)</label>
              <input type="number" value={dec.resourceLimits.commandTimeoutMs} onChange={(e) => setDec({ ...dec, resourceLimits: { ...dec.resourceLimits, commandTimeoutMs: Number(e.target.value) } })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Safe Mode</label>
              <select value={dec.safeMode ? 'true' : 'false'} onChange={(e) => setDec({ ...dec, safeMode: e.target.value === 'true' })} className={inputCls}>
                <option value="true">Enabled (read-only)</option>
                <option value="false">Disabled (can write)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <button onClick={handleSave} disabled={saving || !dec.projectRoot || !dec.testCommand} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
          {saving ? 'Saving...' : 'Save Dev Context'}
        </button>
      </div>
    </div>
  );
}
