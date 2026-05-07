import React from 'react';
import type { AgentFull, AgentBudgetPatch } from '../../../../../../shared/types/build';

interface BudgetTabProps {
  data: AgentFull['budget'];
  onChange: (patch: AgentBudgetPatch) => void;
  pending: AgentBudgetPatch | undefined;
  readOnly: boolean;
}

export default function BudgetTab({ data, pending, readOnly: _readOnly }: BudgetTabProps) {
  const merged = { ...data, ...pending };

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
        <p className="text-xs text-slate-500">
          Budget controls are coming in a future release. These fields are currently read-only.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Daily cap (USD)</label>
        <input
          type="number"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-slate-50 text-slate-400 cursor-not-allowed"
          value={merged.dailyCapUsd ?? ''}
          disabled
          placeholder="No limit"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Monthly cap (USD)</label>
        <input
          type="number"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-slate-50 text-slate-400 cursor-not-allowed"
          value={merged.monthlyCapUsd ?? ''}
          disabled
          placeholder="No limit"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Warn threshold (%)</label>
        <input
          type="number"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-slate-50 text-slate-400 cursor-not-allowed"
          value={merged.warnThresholdPct}
          disabled
          min={0}
          max={100}
        />
      </div>
    </div>
  );
}
