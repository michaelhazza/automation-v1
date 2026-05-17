import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { Section } from './Section';
import type { LinkDetail } from './types';

const inputCls = 'w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white';
const labelCls = 'block text-[13px] font-medium text-slate-700 mb-1.5';

interface InstructionsTabProps {
  link: LinkDetail;
  onSaved(): Promise<void>;
}

export function InstructionsTab({ link, onSaved }: InstructionsTabProps) {
  const [customInstructions, setCustomInstructions] = useState(link.customInstructions ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setCustomInstructions(link.customInstructions ?? '');
  }, [link]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await api.patch(`/api/subaccounts/${link.subaccountId}/agents/${link.id}`, {
        customInstructions: customInstructions || null,
      });
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } | string } }; message?: string };
      const apiErr = err.response?.data?.error;
      const msg = typeof apiErr === 'string' ? apiErr : apiErr?.message;
      setSaveError(msg ?? err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {saveError && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">{saveError}</div>
      )}
      <Section title="Custom Instructions">
        <p className="text-[13px] text-slate-500 mt-0 mb-3">
          Additional instructions appended to the agent's master prompt for this subaccount only. Leave blank to use the org-level prompt without additions.
        </p>
        <label className={labelCls}>Additional instructions</label>
        <textarea
          value={customInstructions}
          onChange={e => setCustomInstructions(e.target.value)}
          rows={8}
          placeholder="e.g. Always sign off reports with the client's name…"
          className={`${inputCls} font-mono resize-y`}
        />
      </Section>
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="btn btn-primary disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Instructions'}
        </button>
        {saved && <span className="text-[13px] text-green-600 font-medium">Saved</span>}
      </div>
    </div>
  );
}
