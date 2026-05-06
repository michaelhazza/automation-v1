import { useState } from 'react';
import api from '../../lib/api';
import { toast } from 'sonner';
import Modal from '../Modal.js';

export type KillSwitchScope = 'policy' | 'subaccount' | 'org';

interface KillSwitchPanelProps {
  scope: KillSwitchScope;
  /** ID relevant to the scope: policyId, subaccountId, or orgId */
  scopeId: string;
  /** Current disabled state */
  disabled: boolean;
  /** Called after a successful kill-switch action so parent can refresh */
  onKilled: () => void;
}

const SCOPE_LABELS: Record<KillSwitchScope, string> = {
  policy:     'policy',
  subaccount: 'sub-account',
  org:        'organisation',
};

const SCOPE_ENDPOINTS: Record<KillSwitchScope, (id: string) => string> = {
  policy:     (id) => `/api/spending-policies/${id}/kill`,
  subaccount: (id) => `/api/spending-budgets/subaccount/${id}/kill`,
  org:        (id) => `/api/spending-budgets/org/${id}/kill`,
};

/**
 * Three-level kill switch UI (per-policy, per-sub-account, per-org).
 * Confirmation modal warns re-enablement is not available in v1.
 * Gating: admin for the relevant scope — enforced server-side; caller controls visibility.
 */
export default function KillSwitchPanel({ scope, scopeId, disabled, onKilled }: KillSwitchPanelProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const label = SCOPE_LABELS[scope];

  const handleKill = async () => {
    setLoading(true);
    try {
      await api.post(SCOPE_ENDPOINTS[scope](scopeId));
      toast.success(`Spend disabled for this ${label}`);
      setShowConfirm(false);
      onKilled();
    } catch {
      toast.error(`Failed to disable spend for this ${label}`);
    } finally {
      setLoading(false);
    }
  };

  if (disabled) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-3">
        <svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-red-500 shrink-0"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
        <div>
          <p className="text-[12.5px] font-semibold text-red-700">
            Spend disabled for this {label}
          </p>
          <p className="text-[12px] text-red-600 mt-0.5">
            Re-enablement is not available in this version. Contact support to restore access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
        <p className="text-[12.5px] font-semibold text-slate-700 mb-1">Kill switch</p>
        <p className="text-[12px] text-slate-500 mb-3">
          Immediately stop all spend for this {label}. This action cannot be undone in v1.
        </p>
        <button
          onClick={() => setShowConfirm(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-semibold rounded-md border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 transition-colors duration-100 cursor-pointer [font-family:inherit]"
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          Disable spend
        </button>
      </div>

      {showConfirm && (
        <Modal
          title={`Disable spend for this ${label}`}
          onClose={() => setShowConfirm(false)}
          maxWidth={440}
          disableBackdropClose
        >
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 mb-4">
            <p className="text-[12.5px] font-semibold text-amber-800 mb-1">Important: permanent action</p>
            <p className="text-[12px] text-amber-700 leading-relaxed">
              Re-enablement is not available in this version.
              Once disabled, spend for this {label} cannot be re-enabled without contacting support.
            </p>
          </div>
          <p className="text-[13px] text-slate-600 mb-5 leading-relaxed">
            All pending charges will be blocked immediately. In-flight reservations will be released.
            Are you sure you want to proceed?
          </p>
          <div className="flex gap-2.5 justify-end">
            <button
              onClick={() => setShowConfirm(false)}
              className="inline-flex items-center gap-1.5 px-[18px] py-[9px] text-[13px] font-semibold rounded-lg border-0 cursor-pointer transition-all duration-150 [font-family:inherit] bg-slate-100 text-gray-700 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleKill}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-[18px] py-[9px] text-[13px] font-semibold rounded-lg border-0 cursor-pointer transition-all duration-150 [font-family:inherit] bg-gradient-to-br from-red-500 to-red-600 text-white shadow-[0_1px_4px_rgba(239,68,68,0.35)] hover:from-red-600 hover:to-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Disabling...' : 'Yes, disable spend'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
