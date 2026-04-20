import { useState } from 'react';

type StaffActivity = {
  countedMutationTypes?: string[];
  excludedUserKinds?: string[];
  lookbackWindowsDays?: number[];
  [key: string]: unknown;
};

interface Props {
  value: unknown;
  onSave: (next: StaffActivity) => Promise<void>;
}

function toCSV(arr: string[] | number[] | undefined): string {
  if (!arr) return '';
  return (arr as unknown[]).join(', ');
}

export default function StaffActivityEditor({ value, onSave }: Props) {
  const [state, setState] = useState<StaffActivity>((value ?? {}) as StaffActivity);
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="block text-[11px] font-bold uppercase text-slate-500">Counted mutation types (comma-separated)</span>
        <input
          value={toCSV(state.countedMutationTypes)}
          onChange={(e) => setState((s) => ({ ...s, countedMutationTypes: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) }))}
          className="w-full px-2 py-1 rounded-md border border-slate-200 text-[12px] font-mono"
        />
      </label>
      <label className="block">
        <span className="block text-[11px] font-bold uppercase text-slate-500">Excluded user kinds (comma-separated)</span>
        <input
          value={toCSV(state.excludedUserKinds)}
          onChange={(e) => setState((s) => ({ ...s, excludedUserKinds: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) }))}
          className="w-full px-2 py-1 rounded-md border border-slate-200 text-[12px] font-mono"
        />
      </label>
      <label className="block">
        <span className="block text-[11px] font-bold uppercase text-slate-500">Lookback windows (days, comma-separated)</span>
        <input
          value={toCSV(state.lookbackWindowsDays)}
          onChange={(e) => setState((s) => ({ ...s, lookbackWindowsDays: e.target.value.split(',').map((v) => Number.parseInt(v.trim(), 10)).filter((n) => Number.isFinite(n)) }))}
          className="w-full px-2 py-1 rounded-md border border-slate-200 text-[12px] font-mono"
        />
      </label>
      <div className="flex justify-end pt-2">
        <button
          disabled={saving}
          onClick={async () => { setSaving(true); try { await onSave(state); } finally { setSaving(false); } }}
          className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
