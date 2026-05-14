// client/src/components/correction/CorrectDialog.tsx
// Operator correction dialog for a single run-trace step.
// Trust & Verification Layer spec §13.1.

import { useState } from 'react';
import { toast } from 'sonner';
import Modal from '../Modal';
import { submitCorrection } from '../../lib/api/corrections';
import { correctionPayloadValidator } from '../../../../shared/types/correction';

interface CorrectDialogProps {
  runId: string;
  eventId: string;
  skillSlug: string;
  originalOutput: string;
  onClose: () => void;
  onSaved?: () => void;
}

export default function CorrectDialog({
  runId,
  eventId,
  skillSlug,
  originalOutput,
  onClose,
  onSaved,
}: CorrectDialogProps) {
  const [editedOutput, setEditedOutput] = useState(originalOutput);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const remainingReasonChars = 500 - reason.length;

  async function handleSave() {
    const error = correctionPayloadValidator({
      editedOutput,
      reason: reason || null,
    });

    if (error === 'EDITED_OUTPUT_EMPTY') {
      setValidationError('Edited output cannot be empty.');
      return;
    }
    if (error === 'EDITED_OUTPUT_TOO_LARGE') {
      setValidationError('Edited output exceeds the 50KB limit.');
      return;
    }
    if (error === 'REASON_TOO_LONG') {
      setValidationError('Reason exceeds 500 characters.');
      return;
    }

    setValidationError(null);
    setSaving(true);

    try {
      await submitCorrection(runId, eventId, {
        agentId: '', // resolved server-side from runId
        skillSlug,
        originalOutput,
        editedOutput,
        reason: reason || null,
      });
      toast.success('Correction saved — Active on next run');
      onSaved?.();
      onClose();
    } catch (err) {
      const e = err as Error & { status?: number; code?: string };
      if (e.status === 404) {
        toast.error('Step not found — refresh the run');
      } else if (e.code === 'EDITED_OUTPUT_EMPTY') {
        setValidationError('Edited output cannot be empty.');
      } else if (e.code === 'EDITED_OUTPUT_TOO_LARGE') {
        setValidationError('Edited output exceeds the 50KB limit.');
      } else {
        toast.error(e.message ?? 'Failed to save correction');
      }
      setSaving(false);
    }
  }

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={onClose}
        disabled={saving}
        className="inline-flex items-center gap-1.5 px-[18px] py-[9px] text-[13px] font-semibold rounded-lg border-0 cursor-pointer transition-all duration-150 font-[inherit] tracking-tight bg-slate-100 text-gray-700 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Cancel
      </button>
      <button
        onClick={handleSave}
        disabled={saving}
        className="inline-flex items-center gap-1.5 px-[18px] py-[9px] text-[13px] font-semibold rounded-lg border-0 cursor-pointer transition-all duration-150 font-[inherit] tracking-tight bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-[0_1px_4px_rgba(99,102,241,0.35)] hover:from-indigo-600 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? (
          <>
            <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
            Saving...
          </>
        ) : (
          'Save correction'
        )}
      </button>
    </div>
  );

  return (
    <Modal
      title="Correct this output"
      onClose={onClose}
      size="sm"
      footer={footer}
      disableBackdropClose={saving}
    >
      <div className="space-y-4">
        {/* Edited output */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            Edited output
          </label>
          <textarea
            rows={6}
            value={editedOutput}
            onChange={(e) => {
              setEditedOutput(e.target.value);
              setValidationError(null);
            }}
            placeholder={originalOutput ? undefined : 'Enter corrected output...'}
            disabled={saving}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent disabled:opacity-50 disabled:bg-slate-50 placeholder:text-slate-400"
          />
          {validationError && (
            <p className="mt-1 text-xs text-rose-600">{validationError}</p>
          )}
        </div>

        {/* Reason */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            Reason <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this correction needed?"
            maxLength={500}
            disabled={saving}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent disabled:opacity-50 disabled:bg-slate-50 placeholder:text-slate-400"
          />
          <p className={`mt-0.5 text-right text-xs ${remainingReasonChars < 50 ? 'text-amber-600' : 'text-slate-400'}`}>
            {remainingReasonChars} remaining
          </p>
        </div>

        {/* About this correction */}
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">About this correction</p>
          <dl className="space-y-1.5">
            <div className="flex gap-2">
              <dt className="text-xs font-medium text-slate-600 w-24 shrink-0">Scope</dt>
              <dd className="text-xs text-slate-700">This agent only</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-xs font-medium text-slate-600 w-24 shrink-0">Persistence</dt>
              <dd className="text-xs text-slate-700">Active on next run</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-xs font-medium text-slate-600 w-24 shrink-0">Confidence</dt>
              <dd className="text-xs text-slate-700">
                High signal — applied immediately, listed under Knowledge where you can edit, override, or reject
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </Modal>
  );
}
