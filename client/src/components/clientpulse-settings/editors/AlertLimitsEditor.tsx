import { useState } from 'react';

type Limits = {
  maxAlertsPerRun?: number;
  maxAlertsPerAccountPerDay?: number;
  batchLowPriority?: boolean;
  [key: string]: unknown;
};

interface Props {
  value: unknown;
  onSave: (next: Limits) => Promise<void>;
}

export default function AlertLimitsEditor({ value, onSave }: Props) {
  const [state, setState] = useState<Limits>((value ?? {}) as Limits);
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[11px] font-bold uppercase text-slate-500">Max alerts per run</span>
          <input type="number" min={0} value={state.maxAlertsPerRun ?? ''} onChange={(e) => setState((s) => ({ ...s, maxAlertsPerRun: e.target.value === '' ? undefined : Number.parseInt(e.target.value, 10) }))} className="w-full px-2 py-1 rounded-md border border-slate-200 text-[13px]" />
        </label>
        <label className="block">
          <span className="block text-[11px] font-bold uppercase text-slate-500">Max alerts / account / day</span>
          <input type="number" min={0} value={state.maxAlertsPerAccountPerDay ?? ''} onChange={(e) => setState((s) => ({ ...s, maxAlertsPerAccountPerDay: e.target.value === '' ? undefined : Number.parseInt(e.target.value, 10) }))} className="w-full px-2 py-1 rounded-md border border-slate-200 text-[13px]" />
        </label>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={!!state.batchLowPriority} onChange={(e) => setState((s) => ({ ...s, batchLowPriority: e.target.checked }))} />
        <span className="text-[12px] text-slate-600">Batch low-priority alerts</span>
      </label>
      <div className="flex justify-end pt-2">
        <button
          disabled={saving}
          onClick={async () => { setSaving(true); try { await onSave(state); } finally { setSaving(false); } }}
          className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          {saving ? 'Saving…' : 'Save limits'}
        </button>
      </div>
    </div>
  );
}
