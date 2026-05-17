// client/src/pages/govern/components/ConnectAiSubscriptionModal.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §Chunk 7
// V1: connectionMechanism = 'none_verified', so the 501 path is the primary
// state. When the backend returns 501, show pending banner. If backend returns
// a different error, show inline error. On success, fire onConnected.

import { useState } from 'react';
import Modal from '../../../components/Modal';
import { connectAiSubscription } from '../../../api/governApi';

interface Props {
  subaccountId: string;
  onClose: () => void;
  onConnected: () => void;
}

type Step = 'provider' | 'plus_disclosure' | 'done' | 'pending_501';

const PLUS_DISCLOSURE_TEXT = `ChatGPT Plus is a personal consumer subscription not designed or approved by OpenAI for business automation use. Connecting a Plus AI Subscription to this platform may violate OpenAI's Terms of Service.

By continuing, you acknowledge:
- Your subscription may be rate-limited or suspended by OpenAI if automated usage is detected.
- OpenAI may modify or revoke access to Plus accounts used for business automation at any time, with or without notice.
- This platform accepts no liability for suspension, data loss, or service interruption resulting from use of a Plus AI Subscription.
- Your organisation is solely responsible for compliance with OpenAI's usage policies.`;

const DISCLOSURE_VERSION = 1;
const DISCLOSURE_CONSENT_TEXT = 'I accept the risk';

type PlanTier = 'pro' | 'team' | 'enterprise' | 'plus';

const TIER_LABELS: Record<PlanTier, string> = {
  pro: 'Pro',
  team: 'Team',
  enterprise: 'Enterprise',
  plus: 'Plus (personal)',
};

// Step indicator
function StepBar({ current }: { current: 1 | 2 | 3 | 4 }) {
  const steps = ['Connect account', 'Plan tier', 'Accept terms', 'Done'];
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((label, i) => {
        const num = i + 1;
        const done = num < current;
        const active = num === current;
        const isPersonalStep = i === 2;
        return (
          <div key={label} className="flex items-center">
            <div className={`flex flex-col items-center ${i > 0 ? 'ml-0' : ''}`}>
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                  done
                    ? 'bg-indigo-600 text-white'
                    : active
                    ? 'bg-white border-2 border-indigo-600 text-indigo-600 shadow-sm'
                    : 'bg-slate-100 text-slate-400'
                }`}
              >
                {done ? '✓' : num}
              </div>
              <div className={`text-[10px] mt-1 text-center leading-tight ${active ? 'font-semibold text-indigo-700' : 'text-slate-400'}`}>
                {label}
                {isPersonalStep && (
                  <div className="text-[9px] text-slate-300 font-normal">personal only</div>
                )}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-8 h-0.5 mx-1 flex-shrink-0 mb-4 ${done ? 'bg-indigo-600' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ConnectAiSubscriptionModal({ subaccountId, onClose, onConnected }: Props) {
  const [step, setStep] = useState<Step>('provider');
  const [label, setLabel] = useState('');
  const [planTier, setPlanTier] = useState<PlanTier>('pro');
  const [plusAck, setPlusAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPlus = planTier === 'plus';

  // Derive step number for the step bar
  function currentStep(): 1 | 2 | 3 | 4 {
    if (step === 'provider') return 1;
    if (step === 'plus_disclosure') return 3;
    if (step === 'done') return 4;
    return 2;
  }

  async function handleConnect() {
    if (!label.trim()) { setError('Label is required.'); return; }
    setError(null);
    setBusy(true);
    try {
      await connectAiSubscription(subaccountId, {
        provider: 'openai',
        label: label.trim(),
        ...(isPlus && {
          disclosureAcceptance: {
            disclosureVersion: DISCLOSURE_VERSION,
            consentText: DISCLOSURE_CONSENT_TEXT,
            acceptanceTier: 'plus',
          },
        }),
      });
      setStep('done');
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } }).response?.status;
      if (status === 501) {
        setStep('pending_501');
      } else {
        const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
        setError(msg ?? (e instanceof Error ? e.message : 'Connect failed. Please try again.'));
      }
    } finally {
      setBusy(false);
    }
  }

  function handleNext() {
    if (step === 'provider') {
      if (!label.trim()) { setError('Label is required.'); return; }
      if (isPlus) {
        setStep('plus_disclosure');
      } else {
        void handleConnect();
      }
    } else if (step === 'plus_disclosure') {
      if (!plusAck) return;
      void handleConnect();
    }
  }

  // ── 501 state ──────────────────────────────────────────────────────────────
  if (step === 'pending_501') {
    return (
      <Modal title="Connect AI Subscription" onClose={onClose} maxWidth={520}>
        <div className="flex items-start gap-3 p-4 bg-sky-50 border border-sky-200 rounded-lg text-[13px] text-sky-800 leading-relaxed">
          <svg className="flex-shrink-0 mt-0.5" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
          </svg>
          <span>Provider verification pending. AI Subscriptions will become available soon.</span>
        </div>
        <div className="flex justify-end mt-5">
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

  // ── Done state ─────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <Modal title="AI Subscription connected" onClose={onClose} maxWidth={480}>
        <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-[13px] text-emerald-800 leading-relaxed">
          <span className="text-lg flex-shrink-0">&#10003;</span>
          <div>
            <strong className="block mb-1">{label} connected.</strong>
            Your AI Subscription is ready. Agents can use it on their next run.
          </div>
        </div>
        <div className="flex justify-end mt-5">
          <button
            type="button"
            onClick={onConnected}
            className="px-4 py-2 text-[13px] font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white border-0 cursor-pointer font-[inherit] transition-colors duration-150"
          >
            Done
          </button>
        </div>
      </Modal>
    );
  }

  // ── Plus disclosure step ───────────────────────────────────────────────────
  if (step === 'plus_disclosure') {
    return (
      <Modal title="Connect AI Subscription" onClose={onClose} maxWidth={580}>
        <StepBar current={currentStep()} />

        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4 text-[13px] text-amber-900">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg bg-amber-200 flex items-center justify-center text-base flex-shrink-0">&#9888;</div>
            <p className="font-semibold text-amber-800 text-[14px]">Personal plan risk disclosure</p>
          </div>
          <p className="font-semibold text-amber-800 mb-2">Consent required for Plus</p>
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-2">Risk disclosure</div>
          <div className="text-[12.5px] leading-relaxed whitespace-pre-line text-amber-900">{PLUS_DISCLOSURE_TEXT}</div>
          <div className="text-[10.5px] text-amber-600 border-t border-amber-300 mt-3 pt-2">
            Disclosure version: {DISCLOSURE_VERSION}
          </div>
        </div>

        <label className="flex items-start gap-2.5 p-3 bg-amber-50/80 border border-amber-200 rounded-lg cursor-pointer mb-1">
          <input
            type="checkbox"
            className="mt-0.5 flex-shrink-0 accent-amber-500"
            checked={plusAck}
            onChange={(e) => setPlusAck(e.target.checked)}
          />
          <span className="text-[13px] font-medium text-amber-900 leading-snug">
            {DISCLOSURE_CONSENT_TEXT}
          </span>
        </label>

        {error && <p className="text-[12px] text-red-600 mt-2">{error}</p>}

        <div className="flex justify-between mt-5">
          <button
            type="button"
            onClick={() => { setStep('provider'); setPlusAck(false); setError(null); }}
            className="px-4 py-2 text-[13px] font-medium rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer font-[inherit]"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={!plusAck || busy}
            className="px-4 py-2 text-[13px] font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white border-0 cursor-pointer font-[inherit] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Connecting...' : 'Connect AI Subscription'}
          </button>
        </div>
      </Modal>
    );
  }

  // ── Provider / plan step (default) ────────────────────────────────────────
  return (
    <Modal title="Connect AI Subscription" onClose={onClose} maxWidth={520}>
      <StepBar current={currentStep()} />

      <p className="text-[13px] text-slate-500 mb-5 leading-relaxed">
        Connect a ChatGPT plan so your autonomous agents can use it when they run.
      </p>

      {/* Label */}
      <div className="mb-4">
        <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
          Label <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => { setLabel(e.target.value); setError(null); }}
          placeholder="e.g. ChatGPT Pro (Marketing)"
          className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-[inherit]"
        />
      </div>

      {/* Provider: OpenAI only */}
      <div className="mb-4">
        <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Provider</label>
        <div className="flex items-center gap-3 p-3 border border-indigo-300 bg-indigo-50/40 rounded-lg">
          <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <path d="M22.2819 9.8211a5.9847 5.9847 0 00-.5157-4.9108 6.0462 6.0462 0 00-6.5098-2.9A6.0651 6.0651 0 004.9807 4.1818a5.9847 5.9847 0 00-3.9977 2.9 6.0462 6.0462 0 00.7427 7.0966 5.98 5.98 0 00.511 4.9107 6.051 6.051 0 006.5146 2.9001A5.9847 5.9847 0 0013.2599 24a6.0557 6.0557 0 005.7718-4.2058 5.9894 5.9894 0 003.9977-2.9001 6.0557 6.0557 0 00-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 01-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 00.3927-.6813v-6.7369l2.02 1.1686a.071.071 0 01.038.052v5.5826a4.504 4.504 0 01-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 01-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 00.7806 0l5.8428-3.3685v2.3324a.0804.0804 0 01-.0332.0615L9.74 19.9502a4.4992 4.4992 0 01-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 012.3655-1.9728V11.6a.7664.7664 0 00.3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 01-.071 0l-4.8303-2.7865A4.504 4.504 0 012.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 01.071 0l4.8303 2.7913a4.4944 4.4944 0 01-.6765 8.1042v-5.6772a.79.79 0 00-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 00-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 01.0284-.0615l4.8303-2.7866a4.4992 4.4992 0 016.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 01-.038-.0567V6.0742a4.4992 4.4992 0 017.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 00-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
            </svg>
          </div>
          <span className="text-[13px] font-semibold text-slate-800">OpenAI / ChatGPT</span>
          <span className="ml-auto text-[10.5px] text-indigo-500 font-medium">Only provider available</span>
        </div>
      </div>

      {/* Plan tier */}
      <div className="mb-4">
        <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Plan tier</label>
        <div className="grid grid-cols-2 gap-2">
          {(['pro', 'team', 'enterprise', 'plus'] as PlanTier[]).map((tier) => (
            <label
              key={tier}
              className={`flex items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                planTier === tier
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-slate-200 bg-white hover:border-indigo-300'
              }`}
            >
              <input
                type="radio"
                name="planTier"
                value={tier}
                checked={planTier === tier}
                onChange={() => { setPlanTier(tier); setError(null); }}
                className="accent-indigo-600 flex-shrink-0"
              />
              <span className="text-[13px] font-medium text-slate-800">{TIER_LABELS[tier]}</span>
              {tier === 'plus' && (
                <span className="ml-auto text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 rounded">Disclosure req.</span>
              )}
            </label>
          ))}
        </div>
        {isPlus && (
          <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded text-[12px] text-amber-800 leading-relaxed">
            Plus is a personal plan. A risk disclosure will be required on the next step.
          </div>
        )}
      </div>

      {error && <p className="text-[12px] text-red-600 mb-3">{error}</p>}

      <div className="flex justify-between mt-5">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-[13px] font-medium rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer font-[inherit]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={busy}
          className="px-4 py-2 text-[13px] font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white border-0 cursor-pointer font-[inherit] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Connecting...' : isPlus ? 'Continue to disclosure' : 'Connect AI Subscription'}
        </button>
      </div>
    </Modal>
  );
}
