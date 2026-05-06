import React from 'react';
import type { WorkspaceIdentityStatus } from '../../../../shared/types/workspace';
import { LifecycleProgress } from './LifecycleProgress';
import { EmailSendingToggle } from './EmailSendingToggle';

export type IdentityCardAction = 'suspend' | 'resume' | 'revoke' | 'archive' | 'toggleEmail';

interface IdentityCardProps {
  identity: {
    id: string;
    emailAddress: string;
    emailSendingEnabled: boolean;
    status: string;
    displayName: string;
  };
  actor: {
    displayName: string;
    agentRole: string | null;
  };
  onSuspend: () => void;
  onResume: () => void;
  onRevoke: () => void;
  onArchive: () => void;
  onToggleEmail: (enabled: boolean) => void;
  pendingAction?: IdentityCardAction | null;
  actionError?: string | null;
}

function isTerminal(status: string): boolean {
  return status === 'archived';
}

function isEmailToggleAllowed(status: string): boolean {
  return status === 'active' || status === 'suspended' || status === 'provisioned';
}

export function IdentityCard({
  identity,
  actor: _actor,
  onSuspend,
  onResume,
  onRevoke,
  onArchive,
  onToggleEmail,
  pendingAction = null,
  actionError = null,
}: IdentityCardProps) {
  const status = identity.status as WorkspaceIdentityStatus;
  const anyPending = pendingAction !== null;
  const emailToggleEnabled = isEmailToggleAllowed(status);

  return (
    <div className="bg-white rounded-[10px] border border-slate-200">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="m-0 text-[15px] font-semibold text-slate-900">Workplace identity</h2>
        </div>
        <LifecycleProgress status={status} />
      </div>
      <div className="p-5 space-y-4">
        <div className="space-y-2 text-sm">
          <div className="flex gap-3">
            <span className="w-28 text-gray-500 shrink-0">Display name</span>
            <span className="text-gray-900 font-medium">{identity.displayName}</span>
          </div>
          <div className="flex gap-3">
            <span className="w-28 text-gray-500 shrink-0">Email</span>
            <code className="text-gray-900 text-xs">{identity.emailAddress}</code>
          </div>
        </div>

        <div>
          <EmailSendingToggle
            enabled={identity.emailSendingEnabled}
            onChange={onToggleEmail}
            disabled={!emailToggleEnabled || (anyPending && pendingAction !== 'toggleEmail')}
            pending={pendingAction === 'toggleEmail'}
          />
        </div>

        {actionError && (
          <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-[12px] text-red-700">
            {actionError}
          </div>
        )}

        {!isTerminal(status) && (
          <div className="flex gap-2 pt-2">
            {status === 'active' && (
              <>
                <button
                  onClick={onSuspend}
                  disabled={anyPending}
                  className="px-3 py-1.5 text-sm bg-amber-500 text-white rounded hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pendingAction === 'suspend' ? 'Suspending…' : 'Suspend'}
                </button>
                <button
                  onClick={onRevoke}
                  disabled={anyPending}
                  className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pendingAction === 'revoke' ? 'Revoking…' : 'Revoke'}
                </button>
              </>
            )}
            {status === 'suspended' && (
              <>
                <button
                  onClick={onResume}
                  disabled={anyPending}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pendingAction === 'resume' ? 'Resuming…' : 'Resume'}
                </button>
                <button
                  onClick={onRevoke}
                  disabled={anyPending}
                  className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pendingAction === 'revoke' ? 'Revoking…' : 'Revoke'}
                </button>
              </>
            )}
            {status === 'revoked' && (
              <button
                onClick={onArchive}
                disabled={anyPending}
                className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pendingAction === 'archive' ? 'Archiving…' : 'Archive'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
