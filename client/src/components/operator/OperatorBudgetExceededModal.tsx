// Modal shown when the per-task operator budget cap is reached (mockup r16).
// Three extension presets + custom-amount input (60-60000, 60-min step).

import { useState } from 'react';
import { extendBudget } from '../../api/operatorBackendApi.js';

interface OperatorBudgetExceededModalProps {
  agentRunId: string;
  onExtended: () => void;
  onClose: () => void;
}

const PRESETS = [1_000, 3_000] as const;

export function OperatorBudgetExceededModal({
  agentRunId,
  onExtended,
  onClose,
}: OperatorBudgetExceededModalProps) {
  const [customMinutes, setCustomMinutes] = useState(60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExtend = async (minutes: number) => {
    setSaving(true);
    setError(null);
    const result = await extendBudget(agentRunId, minutes);
    setSaving(false);
    if (result.ok) {
      onExtended();
    } else {
      setError('Failed to extend budget. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold text-slate-900">Session budget reached</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer text-xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <p className="text-[13px] text-slate-600 mb-4">
          This task has reached its operator session budget. Extend it to continue.
        </p>

        {error && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-[12px] text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2 mb-4">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => handleExtend(preset)}
              disabled={saving}
              className="w-full px-4 py-2 text-[13px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 cursor-pointer disabled:opacity-50"
            >
              Add {preset.toLocaleString()} minutes
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mb-4">
          <label className="text-[12px] text-slate-600 shrink-0">Custom:</label>
          <input
            type="number"
            min={60}
            max={60_000}
            step={60}
            value={customMinutes}
            onChange={(e) => {
              const v = Math.max(60, Math.min(60_000, Number(e.target.value)));
              setCustomMinutes(v);
            }}
            className="flex-1 px-2 py-1 text-[12px] border border-slate-200 rounded outline-none focus:border-indigo-400"
          />
          <span className="text-[12px] text-slate-500 shrink-0">min</span>
          <button
            onClick={() => handleExtend(customMinutes)}
            disabled={saving || customMinutes < 60 || customMinutes > 60_000}
            className="px-3 py-1 text-[12px] font-semibold text-white bg-indigo-600 rounded hover:bg-indigo-700 cursor-pointer border-0 disabled:opacity-50"
          >
            Add
          </button>
        </div>

        <button
          onClick={onClose}
          disabled={saving}
          className="w-full px-4 py-2 text-[13px] font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer bg-white disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
