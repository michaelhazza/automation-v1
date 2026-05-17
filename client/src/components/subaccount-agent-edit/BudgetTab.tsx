import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { Section } from './Section';
import type { LinkDetail } from './types';

const inputCls = 'w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white';
const labelCls = 'block text-[13px] font-medium text-slate-700 mb-1.5';

interface BudgetTabProps {
  link: LinkDetail;
  onSaved(): Promise<void>;
}

export function BudgetTab({ link, onSaved }: BudgetTabProps) {
  const [budget, setBudget] = useState({
    tokenBudgetPerRun: link.tokenBudgetPerRun,
    maxToolCallsPerRun: link.maxToolCallsPerRun,
    timeoutSeconds: link.timeoutSeconds,
    maxCostPerRunCents: link.maxCostPerRunCents ?? ('' as string | number),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setBudget({
      tokenBudgetPerRun: link.tokenBudgetPerRun,
      maxToolCallsPerRun: link.maxToolCallsPerRun,
      timeoutSeconds: link.timeoutSeconds,
      maxCostPerRunCents: link.maxCostPerRunCents ?? '',
    });
  }, [link]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await api.patch(`/api/subaccounts/${link.subaccountId}/agents/${link.id}`, {
        tokenBudgetPerRun: Number(budget.tokenBudgetPerRun),
        maxToolCallsPerRun: Number(budget.maxToolCallsPerRun),
        timeoutSeconds: Number(budget.timeoutSeconds),
        maxCostPerRunCents: budget.maxCostPerRunCents === '' ? null : Number(budget.maxCostPerRunCents),
      });
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } | string } }; message?: string };
      const apiErr = err.response?.data?.error;
      const msg = typeof apiErr === 'string' ? apiErr : apiErr?.message;
      setSaveError(msg ?? err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {saveError && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">{saveError}</div>
      )}
      <Section title="Execution Budget">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Token budget per run</label>
            <input
              type="number"
              min={1000}
              value={budget.tokenBudgetPerRun}
              onChange={e => setBudget(b => ({ ...b, tokenBudgetPerRun: Number(e.target.value) }))}
              className={inputCls}
            />
            <div className="text-[11px] text-slate-400 mt-1">Total input + output tokens allowed per run</div>
          </div>
          <div>
            <label className={labelCls}>Max tool calls per run</label>
            <input
              type="number"
              min={1}
              value={budget.maxToolCallsPerRun}
              onChange={e => setBudget(b => ({ ...b, maxToolCallsPerRun: Number(e.target.value) }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Timeout (seconds)</label>
            <input
              type="number"
              min={30}
              value={budget.timeoutSeconds}
              onChange={e => setBudget(b => ({ ...b, timeoutSeconds: Number(e.target.value) }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Max cost per run (cents)</label>
            <input
              type="number"
              min={0}
              value={budget.maxCostPerRunCents}
              onChange={e => setBudget(b => ({ ...b, maxCostPerRunCents: e.target.value }))}
              placeholder="No limit"
              className={inputCls}
            />
            <div className="text-[11px] text-slate-400 mt-1">Leave blank for no cost cap</div>
          </div>
        </div>
      </Section>
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="btn btn-primary disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Budget'}
        </button>
        {saved && <span className="text-[13px] text-green-600 font-medium">Saved</span>}
      </div>
    </div>
  );
}
