import React, { useState, useCallback } from 'react';
import { onboardAgentToWorkspace } from '../../lib/api';

type Step = 'identity' | 'confirm' | 'progress' | 'success' | 'error';

interface OnboardAgentModalProps {
  open: boolean;
  subaccountId: string;
  agentId: string;
  agentDisplayName: string;
  onClose: () => void;
  onSuccess: (identityId: string) => void;
}

export function OnboardAgentModal({ open, subaccountId, agentId, agentDisplayName, onClose, onSuccess }: OnboardAgentModalProps) {
  const [step, setStep] = useState<Step>('identity');
  const [displayName, setDisplayName] = useState(agentDisplayName);
  const [emailLocalPart, setEmailLocalPart] = useState(agentDisplayName.split(' ')[0]?.toLowerCase() ?? 'agent');
  const [emailSendingEnabled, setEmailSendingEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());

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
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Onboarding failed';
      setError(msg);
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
              </label>
              <label className="block text-sm font-medium">Email address
                <input
                  className="mt-1 block w-full border rounded px-3 py-2 text-sm"
                  value={emailLocalPart}
                  onChange={e => setEmailLocalPart(e.target.value)}
                />
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
              <button onClick={() => setStep('confirm')} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Continue</button>
            </div>
          </>
        )}
        {step === 'confirm' && (
          <>
            <h2 className="text-lg font-semibold mb-4">Confirm onboarding</h2>
            <div className="space-y-2 text-sm text-gray-700">
              <div><span className="font-medium">Name:</span> {displayName}</div>
              <div><span className="font-medium">Email:</span> {emailLocalPart}@workspace</div>
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
