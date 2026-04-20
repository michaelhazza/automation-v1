import { useState } from 'react';
import ArrayEditor from '../shared/ArrayEditor';
import NormalisationFieldset from '../shared/NormalisationFieldset';

type Factor = {
  metricSlug: string;
  label?: string;
  weight: number;
  normalisation?: Record<string, unknown>;
  [key: string]: unknown;
};

interface Props {
  value: unknown;
  onSave: (next: Factor[]) => Promise<void>;
}

export default function HealthScoreFactorsEditor({ value, onSave }: Props) {
  const initial = Array.isArray(value) ? (value as Factor[]) : [];
  const [factors, setFactors] = useState<Factor[]>(initial);
  const [saving, setSaving] = useState(false);

  const sum = factors.reduce((acc, f) => acc + (Number.isFinite(f.weight) ? f.weight : 0), 0);
  const weightError = Math.abs(sum - 1) > 0.001 ? `Weights must sum to 1.0 (currently ${sum.toFixed(3)})` : null;

  return (
    <div className="space-y-3">
      <ArrayEditor<Factor>
        items={factors}
        onChange={setFactors}
        newRow={() => ({ metricSlug: 'new_metric', weight: 0 })}
        addLabel="+ Add factor"
        allowReorder
        renderRow={(f, _i, onPatch) => (
          <div className="grid grid-cols-3 gap-2">
            <input value={f.metricSlug} onChange={(e) => onPatch({ metricSlug: e.target.value })} placeholder="slug" className="px-2 py-1 rounded-md border border-slate-200 text-[12px] font-mono" />
            <input value={f.label ?? ''} onChange={(e) => onPatch({ label: e.target.value })} placeholder="label" className="px-2 py-1 rounded-md border border-slate-200 text-[12px]" />
            <input type="number" step="0.01" min={0} max={1} value={f.weight} onChange={(e) => onPatch({ weight: Number.parseFloat(e.target.value) || 0 })} className="px-2 py-1 rounded-md border border-slate-200 text-[12px]" />
            <div className="col-span-3">
              <NormalisationFieldset value={f.normalisation} onChange={(n) => onPatch({ normalisation: n })} />
            </div>
          </div>
        )}
      />
      {weightError && <div className="text-[12px] text-red-600">{weightError}</div>}
      <div className="flex justify-end">
        <button
          disabled={saving || !!weightError}
          onClick={async () => { setSaving(true); try { await onSave(factors); } finally { setSaving(false); } }}
          className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          {saving ? 'Saving…' : 'Save factors'}
        </button>
      </div>
    </div>
  );
}
