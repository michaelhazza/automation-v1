import { useState } from 'react';

type Retention = Record<string, number | null>;

interface Props {
  value: unknown;
  onSave: (next: Retention) => Promise<void>;
}

export default function DataRetentionEditor({ value, onSave }: Props) {
  const [state, setState] = useState<Retention>((value ?? {}) as Retention);
  const [saving, setSaving] = useState(false);

  const resources = Object.keys(state);
  const addResource = () => {
    const name = window.prompt('Resource key?');
    if (!name) return;
    setState((s) => ({ ...s, [name]: 30 }));
  };

  return (
    <div className="space-y-2">
      {resources.length === 0 && <p className="text-[12px] text-slate-500">No retention rules yet.</p>}
      {resources.map((key) => (
        <div key={key} className="flex items-center gap-2">
          <span className="flex-1 font-mono text-[12px] text-slate-700">{key}</span>
          <input
            type="number"
            min={0}
            value={state[key] ?? ''}
            placeholder="unlimited"
            onChange={(e) => setState((s) => ({ ...s, [key]: e.target.value === '' ? null : Number.parseInt(e.target.value, 10) }))}
            className="w-24 px-2 py-1 rounded-md border border-slate-200 text-[12px]"
          />
          <span className="text-[11px] text-slate-500">days</span>
          <button onClick={() => setState((s) => { const c = { ...s }; delete c[key]; return c; })} className="text-[11px] text-red-600 hover:underline">×</button>
        </div>
      ))}
      <button onClick={addResource} className="text-[12px] font-semibold text-indigo-600 hover:underline">+ Add resource</button>
      <div className="flex justify-end pt-2">
        <button
          disabled={saving}
          onClick={async () => { setSaving(true); try { await onSave(state); } finally { setSaving(false); } }}
          className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          {saving ? 'Saving…' : 'Save retention'}
        </button>
      </div>
    </div>
  );
}
