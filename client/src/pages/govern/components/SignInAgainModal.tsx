// client/src/pages/govern/components/SignInAgainModal.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §Chunk 7
// V1: no live OAuth — triggerReauth returns a mock success message.
// Owner mismatch: show a contact-admin message.

import { useState } from 'react';
import Modal from '../../../components/Modal';
import type { AiSubscriptionConnection } from '../../../../../shared/types/govern.js';
import { triggerReauth } from '../../../api/governApi';

interface Props {
  subaccountId: string;
  connection: AiSubscriptionConnection;
  onClose: () => void;
  onDone: () => void;
}

type State = 'idle' | 'busy' | 'owner_mismatch' | 'success';

export function SignInAgainModal({ subaccountId, connection, onClose, onDone }: Props) {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);

  const label = connection.label ?? `${connection.provider} ${connection.planTier}`;

  async function handleSignIn() {
    setState('busy');
    setError(null);
    try {
      const result = await triggerReauth(subaccountId, connection.id) as { ownerMismatch?: boolean };
      if (result?.ownerMismatch) {
        setState('owner_mismatch');
      } else {
        setState('success');
      }
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } }).response?.status;
      if (status === 409) {
        setState('owner_mismatch');
      } else {
        const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
        setError(msg ?? (e instanceof Error ? e.message : 'Sign in failed. Please try again.'));
        setState('idle');
      }
    }
  }

  // ── Owner mismatch ────────────────────────────────────────────────────────
  if (state === 'owner_mismatch') {
    return (
      <Modal title="Sign in again" onClose={onClose} maxWidth={460}>
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg text-[13px] text-amber-900 leading-relaxed mb-4">
          <span className="text-base flex-shrink-0">&#9888;</span>
          <span>Contact your administrator to transfer ownership.</span>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 border-0 cursor-pointer font-[inherit]"
          >
            Close
          </button>
        </div>
      </Modal>
    );
  }

  // ── Success ───────────────────────────────────────────────────────────────
  if (state === 'success') {
    return (
      <Modal title="Sign in again" onClose={onClose} maxWidth={460}>
        <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-[13px] text-emerald-800 leading-relaxed mb-4">
          <span className="text-lg flex-shrink-0">&#10003;</span>
          <div>
            <strong className="block mb-1">Connection refreshed.</strong>
            Your session for {label} has been renewed. Your plan and settings are unchanged.
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onDone}
            className="px-4 py-2 text-[13px] font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white border-0 cursor-pointer font-[inherit] transition-colors"
          >
            Done
          </button>
        </div>
      </Modal>
    );
  }

  // ── Idle / default ────────────────────────────────────────────────────────
  return (
    <Modal title={`Sign in again to ${label}`} onClose={onClose} maxWidth={460}>
      <p className="text-[13px] text-slate-500 mb-5 leading-relaxed">
        We&apos;ll refresh your connection. Your plan and settings stay the same.
      </p>

      {/* Subscription identity context */}
      <div className="flex items-center gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-lg mb-5">
        <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <svg width="16" height="16" fill="none" stroke="#6366f1" strokeWidth="1.5" viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-[14px] font-semibold text-slate-900">{label}</div>
          <div className="flex items-center gap-2 mt-0.5 text-[12px] text-slate-500">
            <span className={`inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded border capitalize bg-indigo-50 text-indigo-700 border-indigo-200`}>
              {connection.planTier}
            </span>
            <span>{connection.provider}</span>
          </div>
        </div>
      </div>

      {/* Primary CTA */}
      <button
        type="button"
        onClick={() => { void handleSignIn(); }}
        disabled={state === 'busy'}
        className="w-full flex items-center justify-center gap-2.5 py-3 px-5 bg-slate-900 hover:bg-slate-800 text-white text-[14px] font-semibold rounded-lg border-0 cursor-pointer font-[inherit] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <div className="w-5 h-5 bg-white rounded flex items-center justify-center flex-shrink-0">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#0f172a">
            <path d="M22.2819 9.8211a5.9847 5.9847 0 00-.5157-4.9108 6.0462 6.0462 0 00-6.5098-2.9A6.0651 6.0651 0 004.9807 4.1818a5.9847 5.9847 0 00-3.9977 2.9 6.0462 6.0462 0 00.7427 7.0966 5.98 5.98 0 00.511 4.9107 6.051 6.051 0 006.5146 2.9001A5.9847 5.9847 0 0013.2599 24a6.0557 6.0557 0 005.7718-4.2058 5.9894 5.9894 0 003.9977-2.9001 6.0557 6.0557 0 00-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 01-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 00.3927-.6813v-6.7369l2.02 1.1686a.071.071 0 01.038.052v5.5826a4.504 4.504 0 01-4.4945 4.4944z" />
          </svg>
        </div>
        {state === 'busy' ? 'Connecting...' : 'Continue to OpenAI'}
      </button>

      <p className="text-[11.5px] text-slate-400 text-center mt-3 leading-snug">
        If your identity is different from the original owner, you&apos;ll be prompted to transfer ownership instead.
      </p>

      {error && <p className="text-[12px] text-red-600 mt-2 text-center">{error}</p>}

      <div className="flex justify-center mt-4">
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2 text-[13px] font-medium rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 cursor-pointer font-[inherit]"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
