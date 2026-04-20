import { useState } from 'react';
import FireAutomationDefaultsEditor from './payloadSubEditors/FireAutomationDefaultsEditor';
import SendEmailDefaultsEditor from './payloadSubEditors/SendEmailDefaultsEditor';
import SendSmsDefaultsEditor from './payloadSubEditors/SendSmsDefaultsEditor';
import CreateTaskDefaultsEditor from './payloadSubEditors/CreateTaskDefaultsEditor';
import NotifyOperatorDefaultsEditor from './payloadSubEditors/NotifyOperatorDefaultsEditor';
import {
  deserialiseTemplateForEdit,
  serialiseTemplateForSave,
  validateUniqueSlugs,
  type Band,
  type InterventionActionType,
  type InterventionTemplate,
  type TemplateFormState,
} from './interventionTemplateRoundTripPure';

interface Props {
  templates: InterventionTemplate[];
  onSave: (next: InterventionTemplate[]) => Promise<void> | void;
  onCancel?: () => void;
}

const BAND_OPTIONS: Band[] = ['healthy', 'watch', 'atRisk', 'critical'];
const ACTION_TYPE_OPTIONS: InterventionActionType[] = [
  'crm.fire_automation',
  'crm.send_email',
  'crm.send_sms',
  'crm.create_task',
  'notify_operator',
];

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function renderPayloadEditor(
  actionType: InterventionActionType,
  payload: Record<string, unknown>,
  onChange: (next: Record<string, unknown>) => void,
) {
  switch (actionType) {
    case 'crm.fire_automation':
      return <FireAutomationDefaultsEditor payload={payload} onChange={onChange} />;
    case 'crm.send_email':
      return <SendEmailDefaultsEditor payload={payload} onChange={onChange} />;
    case 'crm.send_sms':
      return <SendSmsDefaultsEditor payload={payload} onChange={onChange} />;
    case 'crm.create_task':
      return <CreateTaskDefaultsEditor payload={payload} onChange={onChange} />;
    case 'notify_operator':
      return <NotifyOperatorDefaultsEditor payload={payload} onChange={onChange} />;
  }
}

export default function InterventionTemplatesEditor({ templates, onSave }: Props) {
  const [state, setState] = useState<TemplateFormState[]>(() => templates.map(deserialiseTemplateForEdit));
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (index: number, patch: Partial<TemplateFormState>) => {
    setState((s) => s.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  };

  const addTemplate = () => {
    setState((s) => [
      ...s,
      {
        slug: 'new_template',
        label: 'New template',
        description: '',
        gateLevel: 'review',
        actionType: 'crm.fire_automation',
        targets: [],
        priority: 0,
        measurementWindowHours: 24,
        defaultReason: '',
        payloadDefaults: {},
        passthrough: {},
      },
    ]);
    setEditing('new_template');
  };

  const duplicate = (i: number) => {
    const dup = { ...state[i], slug: `${state[i].slug}_copy`, passthrough: { ...state[i].passthrough } };
    setState((s) => [...s.slice(0, i + 1), dup, ...s.slice(i + 1)]);
  };

  const remove = (i: number) => setState((s) => s.filter((_, ix) => ix !== i));

  const commit = async () => {
    setError(null);
    const uniqueError = validateUniqueSlugs(state);
    if (uniqueError) { setError(uniqueError); return; }
    setSaving(true);
    try {
      await onSave(state.map(serialiseTemplateForSave));
      setEditing(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e?.response?.data?.message ?? e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-bold text-slate-700">Intervention templates ({state.length})</h3>
        <button
          onClick={addTemplate}
          className="px-3 py-1 rounded-md text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
        >
          + Add
        </button>
      </div>

      {state.length === 0 && <p className="text-[13px] text-slate-500">No templates yet. Click "+ Add" to create one.</p>}

      <ul className="space-y-2">
        {state.map((t, i) => {
          const isEditing = editing === t.slug;
          return (
            <li key={`${t.slug}-${i}`} className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-start justify-between px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] text-slate-900">{t.slug}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${t.gateLevel === 'review' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {t.gateLevel}
                    </span>
                    <span className="text-[11px] text-slate-400">{t.actionType}</span>
                  </div>
                  <div className="text-[12px] text-slate-500 mt-0.5 truncate">{t.label}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setEditing(isEditing ? null : t.slug)} className="text-[11px] text-indigo-600 hover:underline">
                    {isEditing ? 'Close' : 'Edit'}
                  </button>
                  <button onClick={() => duplicate(i)} className="text-[11px] text-slate-600 hover:underline">Duplicate</button>
                  <button onClick={() => remove(i)} className="text-[11px] text-red-600 hover:underline">Delete</button>
                </div>
              </div>
              {isEditing && (
                <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/60">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Slug</label>
                      <input
                        value={t.slug}
                        onBlur={(e) => update(i, { slug: slugify(e.target.value) })}
                        onChange={(e) => update(i, { slug: e.target.value })}
                        className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Label</label>
                      <input
                        value={t.label}
                        onChange={(e) => update(i, { label: e.target.value })}
                        className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Description</label>
                    <textarea
                      value={t.description}
                      onChange={(e) => update(i, { description: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Gate level</label>
                      <select value={t.gateLevel} onChange={(e) => update(i, { gateLevel: e.target.value as 'auto' | 'review' })} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]">
                        <option value="auto">auto</option>
                        <option value="review">review</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Action type</label>
                      <select
                        value={t.actionType}
                        onChange={(e) => update(i, { actionType: e.target.value as InterventionActionType, payloadDefaults: {} })}
                        className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]"
                      >
                        {ACTION_TYPE_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Priority</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={t.priority}
                        onChange={(e) => update(i, { priority: Number.parseInt(e.target.value, 10) || 0 })}
                        className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Targets (bands)</label>
                    <div className="flex gap-1">
                      {BAND_OPTIONS.map((band) => (
                        <button
                          key={band}
                          type="button"
                          onClick={() => {
                            const has = t.targets.includes(band);
                            update(i, { targets: has ? t.targets.filter((x) => x !== band) : [...t.targets, band] });
                          }}
                          className={`px-2 py-1 rounded-md text-[11px] font-semibold border ${
                            t.targets.includes(band)
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-slate-600 border-slate-200'
                          }`}
                        >
                          {band}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Measurement window (hours)</label>
                      <input
                        type="number"
                        min={1}
                        max={168}
                        value={t.measurementWindowHours}
                        onChange={(e) => update(i, { measurementWindowHours: Number.parseInt(e.target.value, 10) || 24 })}
                        className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Default reason</label>
                      <input
                        value={t.defaultReason}
                        onChange={(e) => update(i, { defaultReason: e.target.value })}
                        className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]"
                      />
                    </div>
                  </div>
                  <div className="border-t border-slate-200 pt-3">
                    <div className="text-[11px] font-bold uppercase text-slate-500 mb-2">Payload defaults</div>
                    {renderPayloadEditor(t.actionType, t.payloadDefaults, (next) => update(i, { payloadDefaults: next }))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && <div className="text-[12px] text-red-600">{error}</div>}

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={commit}
          disabled={saving}
          className="px-4 py-2 rounded-md text-[13px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          {saving ? 'Saving…' : 'Save templates'}
        </button>
      </div>
    </div>
  );
}
