import { useEffect, useState } from 'react';
import api from '../../lib/api';

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

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function GeneralTab({ orgId, orgName: _orgName }: { orgId: string; orgName: string | null }) {
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
