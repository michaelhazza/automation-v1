import { useState } from 'react';
import ArrayEditor from '../shared/ArrayEditor';

type Milestone = {
  slug: string;
  label?: string;
  targetDays: number;
  signal?: string;
  [key: string]: unknown;
};

interface Props {
  value: unknown;
  onSave: (next: Milestone[]) => Promise<void>;
}

export default function OnboardingMilestonesEditor({ value, onSave }: Props) {
  const initial = Array.isArray(value) ? (value as Milestone[]) : [];
  const [state, setState] = useState<Milestone[]>(initial);
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-3">
      <ArrayEditor<Milestone>
        items={state}
        onChange={setState}
        newRow={() => ({ slug: 'new_milestone', targetDays: 7 })}
        allowReorder
        renderRow={(m, _i, onPatch) => (
          <div className="grid grid-cols-4 gap-2">
            <input value={m.slug} onChange={(e) => onPatch({ slug: e.target.value })} placeholder="slug" className="px-2 py-1 rounded-md border border-slate-200 text-[12px] font-mono" />
            <input value={m.label ?? ''} onChange={(e) => onPatch({ label: e.target.value })} placeholder="label" className="px-2 py-1 rounded-md border border-slate-200 text-[12px]" />
            <input type="number" min={0} value={m.targetDays} onChange={(e) => onPatch({ targetDays: Number.parseInt(e.target.value, 10) || 0 })} placeholder="days" className="px-2 py-1 rounded-md border border-slate-200 text-[12px]" />
            <input value={m.signal ?? ''} onChange={(e) => onPatch({ signal: e.target.value })} placeholder="signal" className="px-2 py-1 rounded-md border border-slate-200 text-[12px] font-mono" />
          </div>
        )}
      />
      <div className="flex justify-end">
        <button
          disabled={saving}
          onClick={async () => { setSaving(true); try { await onSave(state); } finally { setSaving(false); } }}
          className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          {saving ? 'Saving…' : 'Save milestones'}
        </button>
      </div>
    </div>
  );
}
