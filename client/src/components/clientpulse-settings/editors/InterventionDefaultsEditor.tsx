import { useState } from 'react';

type Defaults = {
  cooldownHours?: number;
  cooldownScope?: 'account' | 'org' | 'subaccount';
  defaultGateLevel?: 'auto' | 'review';
  maxProposalsPerDayPerSubaccount?: number;
  maxProposalsPerDayPerOrg?: number;
  minTrialsForOutcomeWeight?: number;
  [key: string]: unknown;
};

interface Props {
  value: unknown;
  onSave: (next: Defaults) => Promise<void>;
}

export default function InterventionDefaultsEditor({ value, onSave }: Props) {
  const [state, setState] = useState<Defaults>((value ?? {}) as Defaults);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Defaults>(key: K, val: Defaults[K]) => setState((s) => ({ ...s, [key]: val }));

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[11px] font-bold uppercase text-slate-500">Cooldown (hours)</span>
          <input type="number" min={0} value={state.cooldownHours ?? ''} onChange={(e) => set('cooldownHours', e.target.value === '' ? undefined : Number.parseInt(e.target.value, 10))} className="w-full px-2 py-1 rounded-md border border-slate-200 text-[13px]" />
        </label>
        <label className="block">
          <span className="block text-[11px] font-bold uppercase text-slate-500">Cooldown scope</span>
          <select value={state.cooldownScope ?? 'subaccount'} onChange={(e) => set('cooldownScope', e.target.value as Defaults['cooldownScope'])} className="w-full px-2 py-1 rounded-md border border-slate-200 text-[13px]">
            <option value="account">account</option>
            <option value="subaccount">subaccount</option>
            <option value="org">org</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] font-bold uppercase text-slate-500">Default gate</span>
          <select value={state.defaultGateLevel ?? 'review'} onChange={(e) => set('defaultGateLevel', e.target.value as Defaults['defaultGateLevel'])} className="w-full px-2 py-1 rounded-md border border-slate-200 text-[13px]">
            <option value="auto">auto</option>
            <option value="review">review</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] font-bold uppercase text-slate-500">Min trials (outcome weight)</span>
          <input type="number" min={1} value={state.minTrialsForOutcomeWeight ?? 5} onChange={(e) => set('minTrialsForOutcomeWeight', Number.parseInt(e.target.value, 10) || 5)} className="w-full px-2 py-1 rounded-md border border-slate-200 text-[13px]" />
        </label>
        <label className="block">
          <span className="block text-[11px] font-bold uppercase text-slate-500">Max proposals / subaccount / day</span>
          <input type="number" min={0} value={state.maxProposalsPerDayPerSubaccount ?? ''} onChange={(e) => set('maxProposalsPerDayPerSubaccount', e.target.value === '' ? undefined : Number.parseInt(e.target.value, 10))} className="w-full px-2 py-1 rounded-md border border-slate-200 text-[13px]" />
        </label>
        <label className="block">
          <span className="block text-[11px] font-bold uppercase text-slate-500">Max proposals / org / day</span>
          <input type="number" min={0} value={state.maxProposalsPerDayPerOrg ?? ''} onChange={(e) => set('maxProposalsPerDayPerOrg', e.target.value === '' ? undefined : Number.parseInt(e.target.value, 10))} className="w-full px-2 py-1 rounded-md border border-slate-200 text-[13px]" />
        </label>
      </div>
      <div className="flex justify-end pt-2">
        <button
          disabled={saving}
          onClick={async () => { setSaving(true); try { await onSave(state); } finally { setSaving(false); } }}
          className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          {saving ? 'Saving…' : 'Save defaults'}
        </button>
      </div>
    </div>
  );
}
