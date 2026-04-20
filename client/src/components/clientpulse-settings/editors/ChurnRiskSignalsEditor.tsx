import { useState } from 'react';
import ArrayEditor from '../shared/ArrayEditor';

type Signal = {
  slug: string;
  type?: string;
  weight: number;
  condition?: string;
  threshold?: number;
  [key: string]: unknown;
};

interface Props {
  value: unknown;
  onSave: (next: Signal[]) => Promise<void>;
}

export default function ChurnRiskSignalsEditor({ value, onSave }: Props) {
  const initial = Array.isArray(value) ? (value as Signal[]) : [];
  const [signals, setSignals] = useState<Signal[]>(initial);
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-3">
      <ArrayEditor<Signal>
        items={signals}
        onChange={setSignals}
        newRow={() => ({ slug: 'new_signal', weight: 0, type: 'threshold' })}
        addLabel="+ Add signal"
        allowReorder
        renderRow={(s, _i, onPatch) => (
          <div className="grid grid-cols-4 gap-2">
            <input value={s.slug} onChange={(e) => onPatch({ slug: e.target.value })} placeholder="slug" className="px-2 py-1 rounded-md border border-slate-200 text-[12px] font-mono" />
            <select value={s.type ?? 'threshold'} onChange={(e) => onPatch({ type: e.target.value })} className="px-2 py-1 rounded-md border border-slate-200 text-[12px]">
              <option value="threshold">threshold</option>
              <option value="presence">presence</option>
              <option value="ratio">ratio</option>
            </select>
            <input type="number" step="0.01" value={s.weight} onChange={(e) => onPatch({ weight: Number.parseFloat(e.target.value) || 0 })} placeholder="weight" className="px-2 py-1 rounded-md border border-slate-200 text-[12px]" />
            <input type="number" step="0.01" value={s.threshold ?? ''} onChange={(e) => onPatch({ threshold: e.target.value === '' ? undefined : Number.parseFloat(e.target.value) })} placeholder="threshold" className="px-2 py-1 rounded-md border border-slate-200 text-[12px]" />
            <input value={s.condition ?? ''} onChange={(e) => onPatch({ condition: e.target.value })} placeholder="condition (optional)" className="col-span-4 px-2 py-1 rounded-md border border-slate-200 text-[12px] font-mono" />
          </div>
        )}
      />
      <div className="flex justify-end">
        <button
          disabled={saving}
          onClick={async () => { setSaving(true); try { await onSave(signals); } finally { setSaving(false); } }}
          className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          {saving ? 'Saving…' : 'Save signals'}
        </button>
      </div>
    </div>
  );
}
