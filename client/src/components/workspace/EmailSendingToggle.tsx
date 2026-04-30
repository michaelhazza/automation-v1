import React from 'react';

interface EmailSendingToggleProps {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  pending?: boolean;
}

export function EmailSendingToggle({ enabled, onChange, disabled = false, pending = false }: EmailSendingToggleProps) {
  const isLocked = disabled || pending;
  return (
    <label className={`flex items-center gap-2 ${isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-busy={pending || undefined}
        disabled={isLocked}
        onClick={() => !isLocked && onChange(!enabled)}
        className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-gray-300'} ${isLocked ? 'cursor-not-allowed' : ''}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`} />
      </button>
      <span className="text-sm text-gray-700">Email sending{pending ? '…' : ''}</span>
    </label>
  );
}
