import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { onboardAgentToWorkspace, getSubaccountWorkspaceConfig } from '../../lib/api';

type Step = 'identity' | 'confirm' | 'progress' | 'success' | 'error';

interface OnboardAgentModalProps {
  open: boolean;
  subaccountId: string;
  agentId: string;
  agentDisplayName: string;
  onClose: () => void;
  onSuccess: (identityId: string) => void;
}

const EMAIL_LOCAL_RE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const EMAIL_LOCAL_MAX = 64;

function defaultLocalPart(displayName: string): string {
  return displayName
    .split(/\s+/)[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    || 'agent';
}

function validateLocalPart(value: string): string | null {
  if (!value) return 'Email address is required.';
  if (value.length > EMAIL_LOCAL_MAX) return `Must be ${EMAIL_LOCAL_MAX} characters or fewer.`;
  if (!EMAIL_LOCAL_RE.test(value)) {
    return 'Use lowercase letters, digits, dots, dashes, or underscores. Cannot start or end with a separator.';
  }
  return null;
}

export function OnboardAgentModal({ open, subaccountId, agentId, agentDisplayName, onClose, onSuccess }: OnboardAgentModalProps) {
  const [step, setStep] = useState<Step>('identity');
  const [displayName, setDisplayName] = useState(agentDisplayName);
  const [emailLocalPart, setEmailLocalPart] = useState(defaultLocalPart(agentDisplayName));
  const [emailSendingEnabled, setEmailSendingEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emailDomain, setEmailDomain] = useState<string>('');
  const [requestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getSubaccountWorkspaceConfig(subaccountId)
      .then((cfg: { emailDomain?: string }) => {
        if (!cancelled && typeof cfg?.emailDomain === 'string') {
          setEmailDomain(cfg.emailDomain);
        }
      })
      .catch((err) => {
        if (!cancelled) console.warn('[OnboardAgentModal] failed to load workspace config', err);
      });
    return () => { cancelled = true; };
  }, [open, subaccountId]);

  const localPartError = useMemo(() => validateLocalPart(emailLocalPart), [emailLocalPart]);
  const displayNameError = !displayName.trim() ? 'Display name is required.' : null;
  const canContinue = !localPartError && !displayNameError;
  const previewEmail = emailDomain
    ? `${emailLocalPart}@${emailDomain}`
    : `${emailLocalPart}@…`;

  const handleConfirm = useCallback(async () => {
    setStep('progress');
    try {
      const result = await onboardAgentToWorkspace(subaccountId, {
        agentId,
        displayName,
        emailLocalPart,
        emailSendingEnabled,
        onboardingRequestId: requestId,
        initiatedByUserId: '', // resolved server-side
      });
      setStep('success');
      onSuccess(result.identityId);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string; error?: { message?: string } | string } } })?.response?.data;
      const errField = msg?.error;
      const text = (typeof errField === 'string' ? errField : errField?.message) ?? msg?.message ?? 'Onboarding failed';
      setError(text);
      setStep('error');
    }
  }, [agentId, subaccountId, displayName, emailLocalPart, emailSendingEnabled, requestId, onSuccess]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        {step === 'identity' && (
          <>
            <h2 className="text-lg font-semibold mb-4">Onboard to workplace</h2>
            <div className="space-y-3">
              <label className="block text-sm font-medium">Display name
                <input
                  className="mt-1 block w-full border rounded px-3 py-2 text-sm"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                />
                {displayNameError && (
                  <span className="block mt-1 text-xs text-red-600">{displayNameError}</span>
                )}
              </label>
              <label className="block text-sm font-medium">Email address
                <div className="mt-1 flex items-center gap-1 text-sm">
                  <input
                    className={`flex-1 border rounded px-3 py-2 text-sm ${localPartError ? 'border-red-300' : ''}`}
                    value={emailLocalPart}
                    onChange={e => setEmailLocalPart(e.target.value.toLowerCase())}
                    aria-invalid={!!localPartError}
                    maxLength={EMAIL_LOCAL_MAX}
                  />
                  <span className="text-gray-500 whitespace-nowrap">@{emailDomain || '…'}</span>
                </div>
                {localPartError && (
                  <span className="block mt-1 text-xs text-red-600">{localPartError}</span>
                )}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={emailSendingEnabled}
                  onChange={e => setEmailSendingEnabled(e.target.checked)}
                  id="email-enabled"
                />
                <label htmlFor="email-enabled" className="text-sm">Enable email sending</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
              <button
                onClick={() => setStep('confirm')}
                disabled={!canContinue}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          </>
        )}
        {step === 'confirm' && (
          <>
            <h2 className="text-lg font-semibold mb-4">Confirm onboarding</h2>
            <div className="space-y-2 text-sm text-gray-700">
              <div><span className="font-medium">Name:</span> {displayName}</div>
              <div><span className="font-medium">Email:</span> {previewEmail}</div>
              <div><span className="font-medium">Email sending:</span> {emailSendingEnabled ? 'Enabled' : 'Disabled'}</div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setStep('identity')} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">Back</button>
              <button onClick={handleConfirm} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Confirm &amp; onboard</button>
            </div>
          </>
        )}
        {step === 'progress' && (
          <div className="text-center py-8">
            <div className="text-sm text-gray-600">Provisioning identity…</div>
          </div>
        )}
        {step === 'success' && (
          <>
            <h2 className="text-lg font-semibold mb-2">Onboarded</h2>
            <p className="text-sm text-gray-600 mb-4">{displayName} is now active in the workplace.</p>
            <div className="flex justify-end">
              <button onClick={onClose} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Done</button>
            </div>
          </>
        )}
        {step === 'error' && (
          <>
            <h2 className="text-lg font-semibold mb-2 text-red-600">Onboarding failed</h2>
            <p className="text-sm text-gray-600 mb-4">{error}</p>
            <div className="flex justify-end">
              <button onClick={() => setStep('identity')} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Try again</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
