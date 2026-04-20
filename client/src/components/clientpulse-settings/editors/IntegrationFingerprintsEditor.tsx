import { useState } from 'react';

type Fingerprints = {
  scanFingerprintTypes?: string[];
  unclassifiedSignalPromotion?: { threshold?: number; cooldownHours?: number };
  [key: string]: unknown;
};

interface Props {
  value: unknown;
  onSave: (next: Fingerprints) => Promise<void>;
}

const FINGERPRINT_TYPE_OPTIONS = ['conversation_provider_id', 'workflow_action_type', 'webhook_url'];

export default function IntegrationFingerprintsEditor({ value, onSave }: Props) {
  const [state, setState] = useState<Fingerprints>((value ?? {}) as Fingerprints);
  const [saving, setSaving] = useState(false);

  const selected = new Set(state.scanFingerprintTypes ?? []);
  const toggle = (t: string) => {
    const next = new Set(selected);
    if (next.has(t)) next.delete(t); else next.add(t);
    setState((s) => ({ ...s, scanFingerprintTypes: Array.from(next) }));
  };

  const promoThreshold = state.unclassifiedSignalPromotion?.threshold ?? 0;

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Scan fingerprint types</label>
        <div className="flex flex-wrap gap-1">
          {FINGERPRINT_TYPE_OPTIONS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggle(t)}
              className={`px-2 py-1 rounded-md text-[11px] font-semibold border ${selected.has(t) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Unclassified promotion threshold</label>
        <input
          type="number"
          min={0}
          value={promoThreshold}
          onChange={(e) => setState((s) => ({ ...s, unclassifiedSignalPromotion: { ...(s.unclassifiedSignalPromotion ?? {}), threshold: Number.parseInt(e.target.value, 10) || 0 } }))}
          className="w-full px-2 py-1 rounded-md border border-slate-200 text-[12px]"
        />
      </div>
      <div className="flex justify-end pt-2">
        <button
          disabled={saving}
          onClick={async () => { setSaving(true); try { await onSave(state); } finally { setSaving(false); } }}
          className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          {saving ? 'Saving…' : 'Save fingerprints'}
        </button>
      </div>
    </div>
  );
}
