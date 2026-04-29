import React from 'react';
import type { WorkspaceIdentityStatus } from '../../../../shared/types/workspace';
import { LifecycleProgress } from './LifecycleProgress';
import { EmailSendingToggle } from './EmailSendingToggle';

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
}

function isTerminal(status: string): boolean {
  return status === 'archived';
}

export function IdentityCard({ identity, actor: _actor, onSuspend, onResume, onRevoke, onArchive, onToggleEmail }: IdentityCardProps) {
  const status = identity.status as WorkspaceIdentityStatus;

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
          <EmailSendingToggle enabled={identity.emailSendingEnabled} onChange={onToggleEmail} />
        </div>

        {!isTerminal(status) && (
          <div className="flex gap-2 pt-2">
            {status === 'active' && (
              <>
                <button
                  onClick={onSuspend}
                  className="px-3 py-1.5 text-sm bg-amber-500 text-white rounded hover:bg-amber-600 transition-colors"
                >
                  Suspend
                </button>
                <button
                  onClick={onRevoke}
                  className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors"
                >
                  Revoke
                </button>
              </>
            )}
            {status === 'suspended' && (
              <>
                <button
                  onClick={onResume}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  Resume
                </button>
                <button
                  onClick={onRevoke}
                  className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors"
                >
                  Revoke
                </button>
              </>
            )}
            {status === 'revoked' && (
              <button
                onClick={onArchive}
                className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition-colors"
              >
                Archive
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
