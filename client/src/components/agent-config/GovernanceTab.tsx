const inputCls = 'w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white';
const labelCls = 'block text-[13px] font-medium text-slate-700 mb-1.5';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-[10px] border border-slate-200 mb-5">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="m-0 text-[15px] font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

const RISK_TIER_LABELS: Record<number, string> = {
  0: 'Tier 0: Read-only, no side effects',
  1: 'Tier 1: Safe writes (own workspace only)',
  2: 'Tier 2: Low-risk external reads',
  3: 'Tier 3: External writes (reversible)',
  4: 'Tier 4: Significant external writes',
  5: 'Tier 5: High-impact or irreversible actions',
  6: 'Tier 6: Critical or destructive actions',
};

export interface GovernanceTabProps {
  maxRiskTier: number;
  requireApprovalAtTier: number;
  saving: boolean;
  saved: boolean;
  onMaxRiskTierChange: (value: number) => void;
  onRequireApprovalAtTierChange: (value: number) => void;
  onSave: () => void;
}

export default function GovernanceTab({
  maxRiskTier,
  requireApprovalAtTier,
  saving,
  saved,
  onMaxRiskTierChange,
  onRequireApprovalAtTierChange,
  onSave,
}: GovernanceTabProps) {
  return (
    <div>
      <Section title="Risk Limits">
        <div className="space-y-5">
          <div>
            <label className={labelCls}>Maximum risk tier</label>
            <select
              value={maxRiskTier}
              onChange={e => onMaxRiskTierChange(Number(e.target.value))}
              className={inputCls}
            >
              {[0, 1, 2, 3, 4, 5, 6].map(tier => (
                <option key={tier} value={tier}>{RISK_TIER_LABELS[tier]}</option>
              ))}
            </select>
            <div className="text-[11px] text-slate-400 mt-1">
              Actions above this tier are blocked for this agent in this subaccount.
            </div>
          </div>

          <div>
            <label className={labelCls}>Require approval for actions at or above tier</label>
            <select
              value={requireApprovalAtTier}
              onChange={e => onRequireApprovalAtTierChange(Number(e.target.value))}
              className={inputCls}
            >
              {[0, 1, 2, 3, 4, 5, 6].map(tier => (
                <option key={tier} value={tier}>Tier {tier} and above</option>
              ))}
            </select>
            <div className="text-[11px] text-slate-400 mt-1">
              Actions at or above this tier will pause for human approval before executing.
            </div>
          </div>
        </div>
      </Section>

      <Section title="Escalation Rules">
        <div className="space-y-2 opacity-50 cursor-not-allowed select-none">
          <div className="text-[13px] font-medium text-slate-700">Escalation rules</div>
          <div className="text-[13px] text-slate-500">
            Configure automated escalation paths when approval is required.
          </div>
          <div className="inline-block text-[11px] font-medium text-slate-400 bg-slate-100 px-2 py-1 rounded">
            Phase 1.5 (coming soon)
          </div>
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="btn btn-primary disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Governance Settings'}
        </button>
        {saved && <span className="text-[13px] text-green-600 font-medium">Saved</span>}
      </div>
    </div>
  );
}
