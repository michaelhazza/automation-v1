// client/src/pages/govern/components/DisclosureVersionBumpModal.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §Chunk 7
// Triggered when disclosure_version increments on an existing Plus subscription.
// Checkbox re-ack required. Submit calls reacceptConsent API.

import { useState } from 'react';
import Modal from '../../../components/Modal';
import type { AiSubscriptionConnection } from '../../../../../shared/types/govern.js';
import { reacceptConsent, disconnectAiSubscription } from '../../../api/governApi';

interface Props {
  subaccountId: string;
  connection: AiSubscriptionConnection;
  disclosureVersion: number;
  onClose: () => void;
  onAccepted: () => void;
  onDisconnected: () => void;
}

const UPDATED_DISCLOSURE = `ChatGPT Plus is a personal consumer subscription not designed or approved by OpenAI for business automation use. Connecting a Plus AI Subscription to this platform may violate OpenAI's Terms of Service.

By continuing to use this subscription, you acknowledge the following risks:
- Your subscription may be rate-limited or suspended by OpenAI if automated usage is detected.
- OpenAI may modify or revoke access to Plus accounts used for business automation at any time, with or without notice.
- This platform accepts no liability for suspension, data loss, or service interruption resulting from use of a Plus AI Subscription for business automation.
- Your organisation is solely responsible for compliance with OpenAI's usage policies.`;

export function DisclosureVersionBumpModal({
  subaccountId,
  connection,
  disclosureVersion,
  onClose,
  onAccepted,
  onDisconnected,
}: Props) {
  const [acked, setAcked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = connection.label ?? `${connection.provider} ${connection.planTier}`;

  async function handleAccept() {
    if (!acked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reacceptConsent(subaccountId, connection.id, {
        disclosureAcceptance: {
          disclosureVersion,
          consentText: 'I accept the updated terms for using a personal plan with business automation.',
          acceptanceTier: 'plus',
        },
      });
      onAccepted();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      setError(msg ?? (e instanceof Error ? e.message : 'Failed to record acceptance. Please try again.'));
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm(`Disconnect "${label}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await disconnectAiSubscription(subaccountId, connection.id);
      onDisconnected();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      setError(msg ?? 'Disconnect failed.');
      setBusy(false);
    }
  }

  return (
    <Modal title="" onClose={onClose} maxWidth={560}>
      {/* Amber header */}
      <div className="-mx-6 -mt-5 px-6 pt-5 pb-4 mb-4 border-b border-amber-300 bg-gradient-to-br from-amber-50 to-yellow-100">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-200 flex items-center justify-center text-lg flex-shrink-0">&#9888;</div>
          <div>
            <h2 className="text-[16px] font-bold text-amber-900 mb-0.5">Plus terms have been updated</h2>
            <p className="text-[13px] text-amber-800 leading-snug">
              We&apos;ve updated the terms for Plus plans. Please review and re-accept to keep using this subscription.
            </p>
          </div>
        </div>
      </div>

      {/* Subscription identity */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-[20px]">&#129302;</span>
        <div className="flex-1">
          <div className="text-[14px] font-bold text-slate-900">{label}</div>
          <div className="flex items-center gap-2 mt-0.5 text-[12px] text-slate-500">
            <span className="inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">Plus</span>
            <span>{connection.provider}</span>
            <span className="text-amber-600 font-medium">Disabled: needs new consent</span>
          </div>
        </div>
      </div>

      {/* Updated disclosure */}
      <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4 text-[12.5px] text-amber-900 leading-relaxed">
        <h4 className="flex items-center gap-2 text-[13px] font-bold text-amber-800 mb-3">
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          Updated risk disclosure
        </h4>
        <div className="whitespace-pre-line">{UPDATED_DISCLOSURE}</div>
        <div className="text-[10.5px] text-amber-600 border-t border-amber-200 mt-3 pt-2">
          Disclosure version: {disclosureVersion}
        </div>
      </div>

      {/* Checkbox re-ack */}
      <label className="flex items-start gap-2.5 p-3 bg-yellow-50 border border-yellow-200 rounded-lg cursor-pointer mb-4">
        <input
          type="checkbox"
          className="mt-0.5 flex-shrink-0 accent-amber-500 w-4 h-4"
          checked={acked}
          onChange={(e) => setAcked(e.target.checked)}
        />
        <span className="text-[13px] font-medium text-amber-900 leading-snug cursor-pointer">
          I accept the updated terms for using a personal plan with business automation.
        </span>
      </label>

      {error && <p className="text-[12px] text-red-600 mb-3">{error}</p>}

      {/* Footer */}
      <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-amber-200">
        <button
          type="button"
          onClick={() => { void handleDisconnect(); }}
          disabled={busy}
          className="mr-auto px-4 py-2 text-[13px] font-medium rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50 cursor-pointer font-[inherit] disabled:opacity-50"
        >
          Disconnect this subscription
        </button>
        <button
          type="button"
          onClick={() => { void handleAccept(); }}
          disabled={!acked || busy}
          className="px-5 py-2 text-[13.5px] font-semibold rounded-lg border-0 bg-amber-600 hover:bg-amber-700 text-white cursor-pointer font-[inherit] transition-colors disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
        >
          {busy ? 'Accepting...' : 'Accept and continue'}
        </button>
      </div>
    </Modal>
  );
}
