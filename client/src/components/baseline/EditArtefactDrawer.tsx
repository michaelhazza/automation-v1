import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import api from '../../lib/api';

// ---------------------------------------------------------------------------
// EditArtefactDrawer — post-onboarding admin edit of a single baseline artefact.
// Spec: F1 §4B. Simple textarea approach for v1; content is sent as
// { payload: { text: string } } to the PATCH route.
// ---------------------------------------------------------------------------

export interface EditArtefactDrawerProps {
  artefactSlug: string;
  subaccountId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function humanName(slug: string): string {
  const short = slug.split('.')[1] ?? slug;
  return short
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

function tierLabel(slug: string): string {
  const tierMap: Record<string, number> = {
    'baseline.brand_identity': 1,
    'baseline.voice_tone': 1,
    'baseline.offer_positioning': 2,
    'baseline.audience_icp': 2,
    'baseline.operating_constraints': 3,
    'baseline.proof_library': 3,
  };
  const t = tierMap[slug];
  return t != null ? `Tier ${t}` : '';
}

export default function EditArtefactDrawer({
  artefactSlug,
  subaccountId,
  open,
  onClose,
  onSaved,
}: EditArtefactDrawerProps) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText('');
    // F1 §6a — emit artefact.capture.started on drawer open. Fire-and-forget;
    // a telemetry failure must never block the edit UI.
    api
      .post(`/api/subaccounts/${subaccountId}/baseline-artefacts/started`, {
        slug: artefactSlug,
      })
      .catch(() => {});
  }, [open, artefactSlug, subaccountId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function handleSave() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await api.patch(
        `/api/subaccounts/${subaccountId}/baseline-artefacts/${artefactSlug}`,
        { payload: { text: text.trim() } },
      );
      toast.success('Artefact updated');
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to save';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const name = humanName(artefactSlug);
  const tier = tierLabel(artefactSlug);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
      onClick={onClose}
    >
      <aside
        className="w-full max-w-[480px] h-full bg-white flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${name}`}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            {tier && (
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                {tier}
              </div>
            )}
            <div className="text-[14.5px] font-semibold text-slate-900 mt-0.5">
              Edit {name}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="w-7 h-7 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-base leading-none border-0 cursor-pointer font-[inherit]"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          <label className="block text-[13px] font-medium text-slate-700">
            Content
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            placeholder={`Enter updated ${name.toLowerCase()} content...`}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-vertical font-mono"
            autoFocus
          />
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!text.trim() || saving}
            className="btn btn-primary"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
