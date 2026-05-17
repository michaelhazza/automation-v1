// client/src/pages/govern/components/MakeDefaultConfirmModal.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §Chunk 7
// State A: business plan (pro/team/enterprise) — simple confirm
// State B: personal plan (plus/unknown) — checkbox re-ack required

import { useState } from 'react';
import Modal from '../../../components/Modal';
import type { AiSubscriptionConnection } from '../../../../../shared/types/govern.js';
import { makeAiSubscriptionDefault } from '../../../api/governApi';

interface Props {
  subaccountId: string;
  connection: AiSubscriptionConnection;
  onClose: () => void;
  onConfirmed: () => void;
}

const PERSONAL_TIERS: AiSubscriptionConnection['planTier'][] = ['plus', 'unknown'];

const DISCLOSURE_TEXT = `ChatGPT Plus is a personal consumer subscription. Using it for business automation may not comply with OpenAI's terms of service. Your subscription may be rate-limited or suspended if OpenAI detects automated usage.

Your organisation is responsible for compliance with OpenAI's usage policies.`;

export function MakeDefaultConfirmModal({ subaccountId, connection, onClose, onConfirmed }: Props) {
  const isPersonal = PERSONAL_TIERS.includes(connection.planTier);
  const [acked, setAcked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canConfirm = !isPersonal || acked;
  const label = connection.label ?? `${connection.provider} ${connection.planTier}`;
  const tierLabel = connection.planTier.charAt(0).toUpperCase() + connection.planTier.slice(1);

  async function handleConfirm() {
    if (!canConfirm || busy) return;
    setBusy(true);
    setError(null);
    try {
      await makeAiSubscriptionDefault(subaccountId, connection.id);
      onConfirmed();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      setError(msg ?? (e instanceof Error ? e.message : 'Failed to set default. Please try again.'));
      setBusy(false);
    }
  }

  // ── State B: personal plan ────────────────────────────────────────────────
  if (isPersonal) {
    return (
      <Modal title="" onClose={onClose} maxWidth={560}>
        {/* Amber header */}
        <div className="-mx-6 -mt-5 px-6 pt-5 pb-4 mb-4 border-b border-amber-300 bg-gradient-to-br from-amber-50 to-yellow-100">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-amber-200 flex items-center justify-center text-base flex-shrink-0">&#9888;</div>
            <h2 className="text-[16px] font-bold text-amber-900">Make {label} the Default?</h2>
          </div>
        </div>

        {/* Warning callout */}
        <div className="flex items-start gap-3 p-3.5 bg-amber-50 border border-amber-300 rounded-lg mb-4 text-[13px] text-amber-900 leading-relaxed">
          <span className="text-base flex-shrink-0">&#9888;</span>
          <span>ChatGPT {tierLabel} is a personal plan. Confirm you accept the risks before making it the Default.</span>
        </div>

        {/* Impact block */}
        <div className="bg-sky-50 border border-sky-200 rounded-lg p-4 mb-3 text-[12.5px]">
          <div className="flex items-center justify-between py-1.5 border-b border-sky-200">
            <span className="text-slate-500 font-medium">New Default</span>
            <span className="font-semibold text-slate-800">{label}</span>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-slate-500 font-medium">Takes effect</span>
            <span className="text-slate-600">On the next run</span>
          </div>
        </div>

        {/* Disclosure */}
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4 text-[12.5px] text-amber-900 leading-relaxed">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-2">Risk disclosure</div>
          <div className="whitespace-pre-line">{DISCLOSURE_TEXT}</div>
          <div className="text-[10.5px] text-amber-600 border-t border-amber-200 mt-3 pt-2">Disclosure version: v1.0</div>
        </div>

        {/* Re-ack checkbox */}
        <label className="flex items-start gap-2.5 p-3 bg-orange-50 border border-orange-200 rounded-lg cursor-pointer mb-4">
          <input
            type="checkbox"
            className="mt-0.5 flex-shrink-0 accent-amber-500 w-4 h-4"
            checked={acked}
            onChange={(e) => setAcked(e.target.checked)}
          />
          <span className="text-[13px] font-medium text-amber-900 leading-snug cursor-pointer">
            I accept the risk of using a personal plan for business automation.
          </span>
        </label>

        {error && <p className="text-[12px] text-red-600 mb-3">{error}</p>}

        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer font-[inherit]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void handleConfirm(); }}
            disabled={!acked || busy}
            className="px-5 py-2 text-[13.5px] font-semibold rounded-lg border-0 bg-amber-600 hover:bg-amber-700 text-white cursor-pointer font-[inherit] transition-colors disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
          >
            {busy ? 'Making default...' : `Make ${tierLabel} the Default`}
          </button>
        </div>
      </Modal>
    );
  }

  // ── State A: business plan ────────────────────────────────────────────────
  return (
    <Modal title={`Make ${label} the Default?`} onClose={onClose} maxWidth={520}>
      <p className="text-[13.5px] text-slate-700 leading-relaxed mb-4">
        {label} will become the Default subscription for agents in this workspace.
      </p>

      {/* Impact block */}
      <div className="bg-sky-50 border border-sky-200 rounded-lg p-4 mb-4 text-[12.5px]">
        <div className="flex items-center justify-between py-1.5 border-b border-sky-200">
          <span className="text-slate-500 font-medium">New Default</span>
          <span className="font-semibold text-slate-800">{label}</span>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b border-sky-200">
          <span className="text-slate-500 font-medium">Plan</span>
          <span className="text-slate-800 capitalize font-semibold">{tierLabel}</span>
        </div>
        <div className="flex items-center justify-between py-1.5">
          <span className="text-slate-500 font-medium">Takes effect</span>
          <span className="text-slate-600">On the next run</span>
        </div>
      </div>

      <p className="text-[11.5px] text-slate-400 mb-4">Takes effect on the next run.</p>

      {error && <p className="text-[12px] text-red-600 mb-3">{error}</p>}

      <div className="flex justify-end gap-2.5">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-[13px] font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer font-[inherit]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => { void handleConfirm(); }}
          disabled={busy}
          className="px-5 py-2 text-[13.5px] font-semibold rounded-lg border-0 bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer font-[inherit] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Making default...' : 'Make Default'}
        </button>
      </div>
    </Modal>
  );
}
