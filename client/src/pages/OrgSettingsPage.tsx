import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { User, getActiveOrgId, getActiveOrgName } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import AdminBoardConfigPage from './AdminBoardConfigPage';
import AdminCategoriesPage from './AdminCategoriesPage';
import AdminEnginesPage from './AdminEnginesPage';
import OrgMemoryPage from './OrgMemoryPage';
import IntegrationsAndCredentialsPage from './IntegrationsAndCredentialsPage';

interface OrgData {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  settings: Record<string, unknown> | null;
  createdAt: string;
  brandColor: string | null;
  requireAgentApproval: boolean;
  pulseMajorThreshold: { perActionMinor: number; perRunMinor: number } | null;
  defaultCurrencyCode: string;
}

type ActiveTab = 'board' | 'categories' | 'engines' | 'memory' | 'integrations' | 'general' | 'permissions';

const TAB_LABELS: Record<ActiveTab, string> = {
  board: 'Board Config',
  categories: 'Categories',
  engines: 'Engines',
  memory: 'Org Memory',
  integrations: 'Integrations',
  general: 'General',
  permissions: 'Permissions',
};

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function OrgSettingsPage({ user }: { user: User }) {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialTab: ActiveTab = tabParam && ['board', 'categories', 'engines', 'memory', 'integrations', 'general', 'permissions'].includes(tabParam)
    ? tabParam as ActiveTab : 'board';
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);

  const orgId = getActiveOrgId();
  const orgName = getActiveOrgName();
  const isSystemAdmin = user.role === 'system_admin';

  // Non-system-admins see: board, categories, engines
  // System admins additionally see: general, permissions
  const visibleTabs: ActiveTab[] = isSystemAdmin
    ? ['board', 'categories', 'engines', 'memory', 'integrations', 'general', 'permissions']
    : ['board', 'categories', 'engines', 'memory', 'integrations'];

  if (!orgId) {
    return (
      <div className="animate-[fadeIn_0.2s_ease-out_both] p-10">
        <h1 className="text-[28px] font-extrabold text-slate-900 mb-2">Manage Organisation</h1>
        <p className="text-[14px] text-slate-500">Select an organisation from the sidebar to view settings.</p>
      </div>
    );
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="mb-6">
        <h1 className="text-[28px] font-extrabold text-slate-900 tracking-tight m-0 mb-1.5">Manage Organisation</h1>
        <p className="text-[14px] text-slate-500 m-0">Manage settings for {orgName ?? 'your organisation'}</p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-[14px] border-b-2 -mb-px transition-colors ${activeTab === tab ? 'border-indigo-600 text-indigo-600 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-700 font-normal'}`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'board' && <AdminBoardConfigPage user={user} embedded />}
      {activeTab === 'categories' && <AdminCategoriesPage user={user} embedded />}
      {activeTab === 'engines' && <AdminEnginesPage user={user} embedded />}
      {activeTab === 'memory' && <OrgMemoryPage embedded />}
      {activeTab === 'integrations' && <IntegrationsAndCredentialsPage user={user} embedded />}
      {activeTab === 'general' && <GeneralTab orgId={orgId} orgName={orgName} />}
      {activeTab === 'permissions' && <PermissionsTab />}
    </div>
  );
}

// ─── General settings tab ────────────────────────────────────────────────────

function GeneralTab({ orgId, orgName: _orgName }: { orgId: string; orgName: string | null }) {
  const [org, setOrg] = useState<OrgData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editPlan, setEditPlan] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [saveMsg, setSaveMsg] = useState('');

  // Branding state
  const [brandColor, setBrandColor] = useState('');
  const [brandColorError, setBrandColorError] = useState('');
  const [savingBrand, setSavingBrand] = useState(false);
  const [brandMsg, setBrandMsg] = useState('');

  // Governance state
  const [requireAgentApproval, setRequireAgentApproval] = useState(false);
  const [savingGovernance, setSavingGovernance] = useState(false);
  const [governanceMsg, setGovernanceMsg] = useState('');

  // Pulse threshold state (display values in major units, e.g. dollars)
  const [perActionMajor, setPerActionMajor] = useState('');
  const [perRunMajor, setPerRunMajor] = useState('');
  const [currencyCode, setCurrencyCode] = useState('AUD');
  const [savingPulse, setSavingPulse] = useState(false);
  const [pulseMsg, setPulseMsg] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get(`/api/organisations/${orgId}`)
      .then(({ data }) => {
        setOrg(data);
        setEditName(data.name);
        setEditSlug(data.slug);
        setEditPlan(data.plan);
        setEditStatus(data.status);
        setBrandColor(data.brandColor ?? '');
        setRequireAgentApproval(data.requireAgentApproval ?? false);
        const t = data.pulseMajorThreshold;
        setPerActionMajor(t ? String(t.perActionMinor / 100) : '50');
        setPerRunMajor(t ? String(t.perRunMinor / 100) : '500');
        setCurrencyCode(data.defaultCurrencyCode ?? 'AUD');
      })
      .catch((err) => console.error('[OrgSettings] Failed to load organisation:', err))
      .finally(() => setLoading(false));
  }, [orgId]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const { data } = await api.patch(`/api/organisations/${orgId}`, {
        name: editName, slug: editSlug, plan: editPlan, status: editStatus,
      });
      setOrg(data);
      setSaveMsg('Settings saved.');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch {
      setSaveMsg('Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div>
        <div className="h-8 w-72 rounded-lg mb-6 bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
        <div className="h-48 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
      </div>
    );
  }

  if (!org) return <p className="text-[14px] text-slate-500">Organisation not found.</p>;

  const hasChanges = editName !== org.name || editSlug !== org.slug || editPlan !== org.plan || editStatus !== org.status;

  const isValidHex = /^#[0-9a-fA-F]{6}$/.test(brandColor);
  const brandHasChanges = brandColor !== (org.brandColor ?? '');

  const handleBrandColorChange = (value: string) => {
    setBrandColor(value);
    if (value && !/^#[0-9a-fA-F]{6}$/.test(value)) {
      setBrandColorError('Must be a valid hex colour (e.g. #4F46E5)');
    } else {
      setBrandColorError('');
    }
  };

  const handleSaveBrand = async () => {
    if (brandColor && !isValidHex) return;
    setSavingBrand(true);
    setBrandMsg('');
    try {
      const { data } = await api.patch(`/api/organisations/${orgId}`, {
        brandColor: brandColor || null,
      });
      setOrg(data);
      setBrandColor(data.brandColor ?? '');
      setBrandMsg('Brand colour saved.');
      setTimeout(() => setBrandMsg(''), 3000);
    } catch {
      setBrandMsg('Failed to save.');
    } finally {
      setSavingBrand(false);
    }
  };

  const handleSaveGovernance = async () => {
    setSavingGovernance(true);
    setGovernanceMsg('');
    try {
      const { data } = await api.patch(`/api/organisations/${orgId}`, {
        requireAgentApproval,
      });
      setOrg(data);
      setRequireAgentApproval(data.requireAgentApproval ?? false);
      setGovernanceMsg('Governance settings saved.');
      setTimeout(() => setGovernanceMsg(''), 3000);
    } catch {
      setGovernanceMsg('Failed to save.');
    } finally {
      setSavingGovernance(false);
    }
  };

  const governanceHasChanges = requireAgentApproval !== (org.requireAgentApproval ?? false);

  const handleSavePulse = async () => {
    const perAction = parseFloat(perActionMajor);
    const perRun = parseFloat(perRunMajor);
    if (isNaN(perAction) || perAction < 0 || isNaN(perRun) || perRun < 0) {
      setPulseMsg('Thresholds must be non-negative numbers.');
      return;
    }
    setSavingPulse(true);
    setPulseMsg('');
    try {
      const { data } = await api.patch(`/api/organisations/${orgId}`, {
        pulseMajorThreshold: {
          perActionMinor: Math.round(perAction * 100),
          perRunMinor: Math.round(perRun * 100),
        },
        defaultCurrencyCode: currencyCode,
      });
      setOrg(data);
      const t = data.pulseMajorThreshold;
      setPerActionMajor(t ? String(t.perActionMinor / 100) : '50');
      setPerRunMajor(t ? String(t.perRunMinor / 100) : '500');
      setCurrencyCode(data.defaultCurrencyCode ?? 'AUD');
      setPulseMsg('Pulse thresholds saved.');
      setTimeout(() => setPulseMsg(''), 3000);
    } catch {
      setPulseMsg('Failed to save.');
    } finally {
      setSavingPulse(false);
    }
  };

  const pulseHasChanges = (() => {
    const t = org.pulseMajorThreshold;
    const origAction = t ? String(t.perActionMinor / 100) : '50';
    const origRun = t ? String(t.perRunMinor / 100) : '500';
    const origCurrency = org.defaultCurrencyCode ?? 'AUD';
    return perActionMajor !== origAction || perRunMajor !== origRun || currencyCode !== origCurrency;
  })();

  return (
    <div className="flex flex-col gap-6 max-w-[600px]">
      {/* General settings */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-[16px] font-bold text-slate-800 m-0 mb-4">General</h2>
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-[12px] font-semibold text-slate-500 mb-1.5">Organisation Name</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-slate-500 mb-1.5">Slug</label>
            <input value={editSlug} onChange={(e) => setEditSlug(e.target.value)} className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-semibold text-slate-500 mb-1.5">Plan</label>
              <select value={editPlan} onChange={(e) => setEditPlan(e.target.value)} className={inputCls}>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="agency">Agency</option>
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-500 mb-1.5">Status</label>
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} className={inputCls}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>

          <div className="text-[12px] text-slate-400">
            Created {new Date(org.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>

          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="btn btn-primary"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            {saveMsg && (
              <span className={`text-[13px] font-medium ${saveMsg.includes('Failed') ? 'text-red-500' : 'text-emerald-600'}`}>
                {saveMsg}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Branding */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-[16px] font-bold text-slate-800 m-0 mb-1">Branding</h2>
        <p className="text-[13px] text-slate-500 m-0 mb-4">Customise your organisation's visual identity. Logo upload coming soon.</p>
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-[12px] font-semibold text-slate-500 mb-1.5">Brand Colour</label>
            <div className="flex items-center gap-3">
              <input
                value={brandColor}
                onChange={(e) => handleBrandColorChange(e.target.value)}
                placeholder="#4F46E5"
                className={`${inputCls} max-w-[180px]`}
              />
              <div
                className="w-9 h-9 rounded-lg border border-slate-200 shrink-0"
                style={{ backgroundColor: isValidHex ? brandColor : '#e2e8f0' }}
              />
            </div>
            {brandColorError && (
              <p className="text-[12px] text-red-500 m-0 mt-1.5">{brandColorError}</p>
            )}
          </div>

          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={handleSaveBrand}
              disabled={!brandHasChanges || (!!brandColor && !isValidHex) || savingBrand}
              className="btn btn-primary"
            >
              {savingBrand ? 'Saving...' : 'Save Branding'}
            </button>
            {brandMsg && (
              <span className={`text-[13px] font-medium ${brandMsg.includes('Failed') ? 'text-red-500' : 'text-emerald-600'}`}>
                {brandMsg}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Governance */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-[16px] font-bold text-slate-800 m-0 mb-1">Governance</h2>
        <p className="text-[13px] text-slate-500 m-0 mb-4">Control how new agents are added to the organisation.</p>
        <div className="flex flex-col gap-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={requireAgentApproval}
              onChange={(e) => setRequireAgentApproval(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-indigo-600 cursor-pointer shrink-0"
            />
            <div>
              <span className="text-[13px] font-semibold text-slate-800 block">Require approval for new agents</span>
              <span className="text-[12px] text-slate-500 block mt-0.5">
                When enabled, newly created agents must be reviewed and approved by an admin before they can be activated. This helps maintain quality and prevent unauthorised automation.
              </span>
            </div>
          </label>

          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={handleSaveGovernance}
              disabled={!governanceHasChanges || savingGovernance}
              className="btn btn-primary"
            >
              {savingGovernance ? 'Saving...' : 'Save Governance'}
            </button>
            {governanceMsg && (
              <span className={`text-[13px] font-medium ${governanceMsg.includes('Failed') ? 'text-red-500' : 'text-emerald-600'}`}>
                {governanceMsg}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Pulse Thresholds */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-[16px] font-bold text-slate-800 m-0 mb-1">Pulse Thresholds</h2>
        <p className="text-[13px] text-slate-500 m-0 mb-4">
          Actions that exceed these cost thresholds are routed to the Major lane in Pulse and require explicit acknowledgment before approval.
        </p>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-semibold text-slate-500 mb-1.5">Per-action threshold ({currencyCode})</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={perActionMajor}
                onChange={(e) => setPerActionMajor(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-500 mb-1.5">Per-run threshold ({currencyCode})</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={perRunMajor}
                onChange={(e) => setPerRunMajor(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-slate-500 mb-1.5">Currency</label>
            <select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} className={`${inputCls} max-w-[180px]`}>
              <option value="AUD">AUD</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
              <option value="EUR">EUR</option>
              <option value="NZD">NZD</option>
              <option value="CAD">CAD</option>
            </select>
          </div>

          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={handleSavePulse}
              disabled={!pulseHasChanges || savingPulse}
              className="btn btn-primary"
            >
              {savingPulse ? 'Saving...' : 'Save Thresholds'}
            </button>
            {pulseMsg && (
              <span className={`text-[13px] font-medium ${pulseMsg.includes('Failed') ? 'text-red-500' : 'text-emerald-600'}`}>
                {pulseMsg}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Permissions tab ─────────────────────────────────────────────────────────

interface Permission { key: string; description: string; groupName: string; }
interface PermissionSet { id: string; name: string; description: string | null; isDefault: boolean; permissionKeys: string[]; }

function PermissionsTab() {
  const [sets, setSets] = useState<PermissionSet[]>([]);
  const [allPerms, setAllPerms] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [editSet, setEditSet] = useState<PermissionSet | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    try {
      const [setsRes, permsRes] = await Promise.all([api.get('/api/permission-sets'), api.get('/api/permissions')]);
      setSets(setsRes.data);
      setAllPerms(permsRes.data);
    } catch {
      // Permission denied
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setError('');
    try {
      await api.post('/api/permission-sets', createForm);
      setShowCreateForm(false); setCreateForm({ name: '', description: '' }); load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create permission set');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/permission-sets/${deleteId}`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to delete permission set');
    }
    setDeleteId(null); load();
  };

  const handleSaveKeys = async (setId: string, keys: string[]) => {
    setError(''); setSuccess('');
    try {
      await api.put(`/api/permission-sets/${setId}/items`, { permissionKeys: keys });
      setSuccess('Permission set updated'); load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to update permission keys');
    }
  };

  const permsByGroup = allPerms.reduce<Record<string, Permission[]>>((acc, p) => {
    if (!acc[p.groupName]) acc[p.groupName] = [];
    acc[p.groupName].push(p);
    return acc;
  }, {});

  if (loading) return <div className="text-sm text-slate-500">Loading...</div>;

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <p className="text-[14px] text-slate-500 m-0">Define reusable bundles of permissions for org users and subaccount members</p>
        <button
          onClick={() => { setShowCreateForm(true); setError(''); }}
          className="btn btn-primary"
        >
          + New set
        </button>
      </div>

      {error && <div className="text-[13px] text-red-600 mb-4">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 mb-4 text-[13px] text-green-700">{success}</div>}

      {showCreateForm && (
        <Modal title="New permission set" onClose={() => setShowCreateForm(false)} maxWidth={400}>
          <div className="grid gap-3.5 mb-5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name *</label>
              <input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description</label>
              <textarea value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} rows={2} className={`${inputCls} resize-vertical`} />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleCreate} className="btn btn-primary">Create</button>
            <button onClick={() => setShowCreateForm(false)} className="btn btn-secondary">Cancel</button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog title="Delete permission set" message="Delete this permission set? Users assigned to it will lose their permissions." confirmLabel="Delete" onConfirm={handleDeleteConfirm} onCancel={() => setDeleteId(null)} />
      )}

      {editSet && (
        <PermissionSetEditor
          set={editSet}
          permsByGroup={permsByGroup}
          onSave={(keys) => { handleSaveKeys(editSet.id, keys); setEditSet(null); }}
          onClose={() => setEditSet(null)}
        />
      )}

      <div className="flex flex-col gap-3">
        {sets.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl py-12 text-center text-sm text-slate-500">
            No permission sets yet.
          </div>
        ) : sets.map((ps) => (
          <div key={ps.id} className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-1">
                <span className="font-semibold text-[15px] text-slate-800">{ps.name}</span>
                {ps.isDefault && <span className="text-[11px] bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 font-medium">default</span>}
              </div>
              {ps.description && <div className="text-[13px] text-slate-500 mb-1.5">{ps.description}</div>}
              <div className="text-xs text-slate-400">{ps.permissionKeys.length} permission{ps.permissionKeys.length !== 1 ? 's' : ''}</div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => setEditSet(ps)} className="btn btn-sm btn-secondary">
                Edit permissions
              </button>
              {!ps.isDefault && (
                <button onClick={() => setDeleteId(ps.id)} className="btn btn-sm btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700">
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Permission group friendly metadata ───────────────────────────────────────

const GROUP_META: Record<string, { label: string; description: string }> = {
  'org.automations':  { label: 'Automations',  description: 'Control who can view, create, edit, delete and run automations for this organisation.' },
  'org.connections':  { label: 'Connections',  description: 'Access to view integration and connection status across subaccounts.' },
  'org.executions':   { label: 'Executions',   description: 'Access to view execution history and logs across the organisation.' },
  'org.users':        { label: 'Users',        description: 'Manage team members — invite, view roles, and remove users from the organisation.' },
  'org.agents':       { label: 'Agents',       description: 'Manage AI agents — create, configure, activate and assign agents within the organisation.' },
  'org.subaccounts':  { label: 'Companies',    description: 'Manage client companies (subaccounts) — create, view and configure subaccounts.' },
  'org.billing':      { label: 'Billing',      description: 'Access billing information and manage subscription details.' },
  'org.settings':     { label: 'Settings',     description: 'Modify organisation-level settings and configuration.' },
  'org.skills':       { label: 'Skills',       description: 'Manage AI skills — create and configure reusable skill definitions.' },
  'org.workflows':    { label: 'Workflows',    description: 'Access and manage automation workflows.' },
};

function getGroupMeta(groupKey: string) {
  return GROUP_META[groupKey] ?? { label: groupKey.replace(/^org\./, '').replace(/\./g, ' '), description: '' };
}

// ─── Permission set editor modal ──────────────────────────────────────────────

function PermissionSetEditor({
  set, permsByGroup, onSave, onClose,
}: {
  set: PermissionSet;
  permsByGroup: Record<string, Permission[]>;
  onSave: (keys: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(set.permissionKeys));
  const [tooltip, setTooltip] = useState<string | null>(null);

  const toggle = (key: string) => {
    setSelected((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };

  const toggleGroup = (keys: string[]) => {
    const allSelected = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) keys.forEach((k) => next.delete(k)); else keys.forEach((k) => next.add(k));
      return next;
    });
  };

  return (
    <Modal title={`Edit permissions: ${set.name}`} onClose={onClose} maxWidth={580}>
      <p className="m-0 mb-4 text-[13px] text-slate-500">
        Select which actions members with this role can perform. Toggle a category header to select or deselect all permissions in that group.
      </p>
      <div className="max-h-[420px] overflow-y-auto -mx-1 px-1 mb-5 space-y-2">
        {Object.entries(permsByGroup).map(([group, perms]) => {
          const groupKeys = perms.map((p) => p.key);
          const allGroupSelected = groupKeys.every((k) => selected.has(k));
          const someGroupSelected = groupKeys.some((k) => selected.has(k)) && !allGroupSelected;
          const meta = getGroupMeta(group);
          return (
            <div key={group} className="border border-slate-200 rounded-xl overflow-hidden">
              {/* Group header */}
              <div
                className="flex items-center gap-3 px-4 py-3 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors select-none"
                onClick={() => toggleGroup(groupKeys)}
              >
                <input
                  type="checkbox"
                  readOnly
                  checked={allGroupSelected}
                  ref={(el) => { if (el) el.indeterminate = someGroupSelected; }}
                  className="cursor-pointer w-4 h-4 accent-indigo-600"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-semibold text-slate-800">{meta.label}</span>
                  <span className="ml-2 text-[11px] text-slate-400 font-mono">{group}</span>
                </div>
                {meta.description && (
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setTooltip(tooltip === group ? null : group); }}
                      className="w-5 h-5 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-500 text-[11px] font-bold flex items-center justify-center border-0 cursor-pointer transition-colors"
                    >
                      ?
                    </button>
                    {tooltip === group && (
                      <div className="absolute right-0 top-7 z-10 w-64 bg-slate-800 text-white text-[12px] rounded-lg px-3 py-2 shadow-lg leading-snug">
                        {meta.description}
                        <div className="absolute -top-1.5 right-2 w-3 h-3 bg-slate-800 rotate-45" />
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* Permissions list */}
              <div className="divide-y divide-slate-50">
                {perms.map((p) => (
                  <label
                    key={p.key}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${selected.has(p.key) ? 'bg-indigo-50' : 'bg-white hover:bg-slate-50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(p.key)}
                      onChange={() => toggle(p.key)}
                      className="cursor-pointer w-4 h-4 accent-indigo-600 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] text-slate-800">{p.description}</span>
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono shrink-0 hidden sm:inline">{p.key}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-slate-400">{selected.size} permission{selected.size !== 1 ? 's' : ''} selected</span>
        <div className="flex gap-3">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={() => onSave([...selected])} className="btn btn-primary">
            Save changes
          </button>
        </div>
      </div>
    </Modal>
  );
}
