import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { toast } from 'sonner';
import { User } from '../lib/auth';
import EmptyAllowlistBanner from '../components/spend/EmptyAllowlistBanner';
import ConservativeDefaultsButton from '../components/spend/ConservativeDefaultsButton';
import KillSwitchPanel from '../components/spend/KillSwitchPanel';
import PromotePolicyConfirmationModal from '../components/spend/PromotePolicyConfirmationModal';
import { formatMoney } from '../lib/formatMoney';

interface SpendingPolicy {
  id: string;
  mode: 'shadow' | 'live';
  perTxnLimitMinor: number | null;
  dailyLimitMinor: number | null;
  monthlyLimitMinor: number | null;
  alertThresholdPct: number | null;
  version: number;
}

interface SpendingBudget {
  id: string;
  name: string;
  currency: string;
  disabledAt: string | null;
  monthlyAlertThresholdMinor: number | null;
  merchantAllowlist: string[];
  policies: SpendingPolicy[];
}

interface SpendingBudgetDetailPageProps {
  user: User;
  canEdit: boolean;
}

export default function SpendingBudgetDetailPage({ user: _user, canEdit }: SpendingBudgetDetailPageProps) {
  const { budgetId } = useParams<{ budgetId: string }>();
  const [budget, setBudget] = useState<SpendingBudget | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState(false);
  const retryCountRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [allowlistInput, setAllowlistInput] = useState('');
  const [alertThreshold, setAlertThreshold] = useState('');
  const [showPromoteModal, setShowPromoteModal] = useState(false);
  const [promotePending, setPromotePending] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/api/spending-budgets/${budgetId}`);
      if (mountedRef.current) {
        setBudget(data);
        setName(data.name);
        setAllowlistInput((data.merchantAllowlist ?? []).join('\n'));
        setAlertThreshold(
          data.monthlyAlertThresholdMinor != null
            ? String(data.monthlyAlertThresholdMinor)
            : ''
        );
        setFatalError(false);
      }
    } catch {
      if (mountedRef.current) {
        toast.error('Failed to load Spending Budget');
        retryCountRef.current += 1;
        if (retryCountRef.current >= 3) setFatalError(true);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => { if (budgetId) load(); }, [budgetId]);

  const handleSaveName = async () => {
    if (!budget || !name.trim()) return;
    setSaving(true);
    try {
      await api.patch(`/api/spending-budgets/${budget.id}`, { name: name.trim() });
      toast.success('Budget name updated');
      setBudget(prev => prev ? { ...prev, name: name.trim() } : prev);
    } catch {
      toast.error('Failed to update name');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAllowlist = async () => {
    if (!budget) return;
    const list = allowlistInput
      .split('\n')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    setSaving(true);
    try {
      await api.patch(`/api/spending-budgets/${budget.id}`, { merchantAllowlist: list });
      toast.success('Allowlist updated');
      setBudget(prev => prev ? { ...prev, merchantAllowlist: list } : prev);
    } catch {
      toast.error('Failed to update allowlist');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAlert = async () => {
    if (!budget) return;
    const val = alertThreshold === '' ? null : parseInt(alertThreshold, 10);
    setSaving(true);
    try {
      await api.patch(`/api/spending-budgets/${budget.id}`, { monthlyAlertThresholdMinor: val });
      toast.success('Alert threshold updated');
      setBudget(prev => prev ? { ...prev, monthlyAlertThresholdMinor: val } : prev);
    } catch {
      toast.error('Failed to update alert threshold');
    } finally {
      setSaving(false);
    }
  };

  const handlePolicyLimitSave = async (policyId: string, field: string, valueMinor: number | null) => {
    setSaving(true);
    try {
      await api.patch(`/api/spending-policies/${policyId}`, { [field]: valueMinor });
      toast.success('Policy limit updated');
      setBudget(prev => prev ? {
        ...prev,
        policies: prev.policies.map(p => p.id === policyId ? { ...p, [field]: valueMinor } : p),
      } : prev);
    } catch {
      toast.error('Failed to update policy limit');
    } finally {
      setSaving(false);
    }
  };

  const handlePromoteToLive = () => {
    setShowPromoteModal(true);
  };

  const handlePromoteConfirm = async () => {
    if (!budget) return;
    setPromoting(true);
    try {
      const { data } = await api.post<{ outcome: string; actionId: string }>(
        `/api/spending-budgets/${budget.id}/promote-to-live`,
      );
      if (data.outcome === 'promotion_already_pending') {
        setPromotePending(true);
        toast.info('A promotion is already pending approval.');
      } else {
        setPromotePending(true);
        toast.success('Promotion request sent. Waiting for approver confirmation.');
      }
      setShowPromoteModal(false);
    } catch {
      toast.error('Failed to request promotion. Please try again.');
    } finally {
      setPromoting(false);
    }
  };

  if (fatalError) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4">
          <p className="text-[13px] font-semibold text-red-700 mb-1">Unable to load Spending Budget</p>
          <p className="text-[12.5px] text-red-600 mb-3">
            Multiple attempts failed. Contact{' '}
            <a href="mailto:support@synthetos.ai" className="underline">support</a> if this persists.
          </p>
          <button
            onClick={() => { retryCountRef.current = 0; setFatalError(false); load(); }}
            className="px-3 py-1.5 text-[12.5px] font-semibold rounded-md bg-red-100 text-red-700 hover:bg-red-200 border-0 cursor-pointer [font-family:inherit]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (loading || !budget) {
    return (
      <div className="p-8 max-w-3xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-slate-100 rounded-lg animate-pulse" />
        <div className="h-4 w-64 bg-slate-100 rounded animate-pulse" />
        <div className="h-32 bg-slate-100 rounded-lg animate-pulse" />
        <div className="h-32 bg-slate-100 rounded-lg animate-pulse" />
      </div>
    );
  }

  const policy = budget.policies?.[0] ?? null;
  const allowlist = budget.merchantAllowlist ?? [];
  const isLive = policy?.mode === 'live';

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link to="/admin/spending-budgets" className="text-[12.5px] text-slate-400 hover:text-slate-600 no-underline">
              Spending Budgets
            </Link>
            <span className="text-slate-300 text-[12px]">›</span>
            <span className="text-[12.5px] text-slate-700 font-medium">{budget.name}</span>
          </div>
          <h1 className="text-[20px] font-bold text-slate-900">{budget.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[12.5px] text-slate-500">Currency: <strong>{budget.currency}</strong></span>
            <span className="text-slate-300">·</span>
            {policy && (
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${isLive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                {policy.mode}
              </span>
            )}
            {budget.disabledAt && (
              <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700">disabled</span>
            )}
          </div>
        </div>
        {canEdit && !isLive && policy && (
          promotePending ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium rounded-md border border-amber-300 bg-amber-50 text-amber-800 shrink-0">
              Promotion pending approval
            </span>
          ) : (
            <button
              type="button"
              onClick={handlePromoteToLive}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-semibold rounded-md border border-green-300 bg-green-50 text-green-800 hover:bg-green-100 transition-colors duration-100 border-solid cursor-pointer [font-family:inherit] shrink-0"
            >
              Promote to live
            </button>
          )
        )}
      </div>

      {/* Empty allowlist banner */}
      {allowlist.length === 0 && (
        <EmptyAllowlistBanner
          onLoadDefaults={() => {
            if (budget) {
              const btn = document.querySelector('[data-conservative-defaults]');
              if (btn instanceof HTMLElement) btn.click();
            }
          }}
        />
      )}

      {/* Name */}
      {canEdit && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
          <p className="text-[13px] font-semibold text-slate-700 mb-2">Budget name</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="flex-1 border border-slate-200 rounded-md px-3 py-1.5 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={handleSaveName}
              disabled={saving || name.trim() === budget.name}
              className="px-3 py-1.5 text-[12.5px] font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed border-0 cursor-pointer [font-family:inherit]"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Policy limits */}
      {policy && (
        <PolicyLimitsSection
          policy={policy}
          currency={budget.currency}
          canEdit={canEdit}
          onSave={handlePolicyLimitSave}
          saving={saving}
        />
      )}

      {/* Monthly alert threshold */}
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
        <p className="text-[13px] font-semibold text-slate-700 mb-1">Monthly spend alert threshold</p>
        <p className="text-[12px] text-slate-500 mb-2">
          Send an alert when monthly settled spend exceeds this amount (in {budget.currency} minor units). Leave blank to disable.
        </p>
        {canEdit ? (
          <div className="flex gap-2 items-center">
            <input
              type="number"
              min="0"
              value={alertThreshold}
              onChange={e => setAlertThreshold(e.target.value)}
              placeholder="e.g. 50000 = $500.00"
              className="w-48 border border-slate-200 rounded-md px-3 py-1.5 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={handleSaveAlert}
              disabled={saving}
              className="px-3 py-1.5 text-[12.5px] font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed border-0 cursor-pointer [font-family:inherit]"
            >
              Save
            </button>
            {budget.monthlyAlertThresholdMinor != null && (
              <span className="text-[12px] text-slate-400">
                Currently: {formatMoney(budget.monthlyAlertThresholdMinor / 100, { currency: budget.currency })}
              </span>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-slate-700">
            {budget.monthlyAlertThresholdMinor != null
              ? formatMoney(budget.monthlyAlertThresholdMinor / 100, { currency: budget.currency })
              : 'Not set'}
          </p>
        )}
      </div>

      {/* Merchant allowlist */}
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <p className="text-[13px] font-semibold text-slate-700 mb-0.5">Merchant allowlist</p>
            <p className="text-[12px] text-slate-500">
              One descriptor per line (uppercase). Only these merchants may charge through this budget.
            </p>
          </div>
          {canEdit && (
            <span data-conservative-defaults>
              <ConservativeDefaultsButton
                budgetId={budget.id}
                onApplied={load}
              />
            </span>
          )}
        </div>
        {canEdit ? (
          <>
            <textarea
              value={allowlistInput}
              onChange={e => setAllowlistInput(e.target.value)}
              rows={6}
              placeholder="OPENAI&#10;ANTHROPIC&#10;CLOUDFLARE"
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-[12.5px] font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={handleSaveAllowlist}
                disabled={saving}
                className="px-3 py-1.5 text-[12.5px] font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed border-0 cursor-pointer [font-family:inherit]"
              >
                Save allowlist
              </button>
            </div>
          </>
        ) : (
          allowlist.length === 0 ? (
            <p className="text-[12.5px] text-slate-400">No merchants in allowlist — all charges will block.</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {allowlist.map(m => (
                <li key={m} className="text-[12.5px] font-mono text-slate-700">{m}</li>
              ))}
            </ul>
          )
        )}
      </div>

      {/* Kill switch */}
      {canEdit && !budget.disabledAt && (
        <KillSwitchPanel
          scope="policy"
          scopeId={policy?.id ?? budget.id}
          disabled={false}
          onKilled={load}
        />
      )}
      {budget.disabledAt && (
        <KillSwitchPanel
          scope="policy"
          scopeId={policy?.id ?? budget.id}
          disabled
          onKilled={load}
        />
      )}

      {showPromoteModal && (
        <PromotePolicyConfirmationModal
          onConfirm={handlePromoteConfirm}
          onCancel={() => setShowPromoteModal(false)}
          loading={promoting}
        />
      )}
    </div>
  );
}

// ── Policy limits sub-section ──────────────────────────────────────────────

interface PolicyLimitsSectionProps {
  policy: SpendingPolicy;
  currency: string;
  canEdit: boolean;
  onSave: (policyId: string, field: string, value: number | null) => Promise<void>;
  saving: boolean;
}

function PolicyLimitsSection({ policy, currency, canEdit, onSave, saving }: PolicyLimitsSectionProps) {
  const [perTxn, setPerTxn] = useState(policy.perTxnLimitMinor != null ? String(policy.perTxnLimitMinor) : '');
  const [daily, setDaily] = useState(policy.dailyLimitMinor != null ? String(policy.dailyLimitMinor) : '');
  const [monthly, setMonthly] = useState(policy.monthlyLimitMinor != null ? String(policy.monthlyLimitMinor) : '');
  const [threshold, setThreshold] = useState(policy.alertThresholdPct != null ? String(policy.alertThresholdPct) : '');

  const parseOrNull = (v: string) => v === '' ? null : parseInt(v, 10);

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
      <p className="text-[13px] font-semibold text-slate-700 mb-3">
        Policy limits
        <span className="ml-2 text-[11px] font-normal text-slate-400">v{policy.version}</span>
      </p>
      <div className="grid grid-cols-2 gap-4">
        <LimitField
          label="Per-transaction limit"
          hint={`minor units (${currency})`}
          value={perTxn}
          onChange={setPerTxn}
          canEdit={canEdit}
          saving={saving}
          onSave={() => onSave(policy.id, 'perTxnLimitMinor', parseOrNull(perTxn))}
        />
        <LimitField
          label="Daily limit"
          hint={`minor units (${currency})`}
          value={daily}
          onChange={setDaily}
          canEdit={canEdit}
          saving={saving}
          onSave={() => onSave(policy.id, 'dailyLimitMinor', parseOrNull(daily))}
        />
        <LimitField
          label="Monthly limit"
          hint={`minor units (${currency})`}
          value={monthly}
          onChange={setMonthly}
          canEdit={canEdit}
          saving={saving}
          onSave={() => onSave(policy.id, 'monthlyLimitMinor', parseOrNull(monthly))}
        />
        <LimitField
          label="Approval threshold"
          hint="minor units — charges above require approval"
          value={threshold}
          onChange={setThreshold}
          canEdit={canEdit}
          saving={saving}
          onSave={() => onSave(policy.id, 'alertThresholdPct', parseOrNull(threshold))}
        />
      </div>
    </div>
  );
}

interface LimitFieldProps {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  canEdit: boolean;
  saving: boolean;
  onSave: () => void;
}

function LimitField({ label, hint, value, onChange, canEdit, saving, onSave }: LimitFieldProps) {
  return (
    <div>
      <label className="block text-[11.5px] font-medium text-slate-600 mb-0.5">{label}</label>
      <p className="text-[11px] text-slate-400 mb-1">{hint}</p>
      {canEdit ? (
        <div className="flex gap-1.5">
          <input
            type="number"
            min="0"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="unlimited"
            className="flex-1 border border-slate-200 rounded px-2 py-1 text-[12.5px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-0"
          />
          <button
            onClick={onSave}
            disabled={saving}
            className="px-2 py-1 text-[11.5px] font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-700 transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed border-0 cursor-pointer [font-family:inherit]"
          >
            Save
          </button>
        </div>
      ) : (
        <p className="text-[13px] text-slate-700">{value || 'unlimited'}</p>
      )}
    </div>
  );
}
