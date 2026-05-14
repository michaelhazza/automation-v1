import { useEffect, useState } from 'react';
import { IdentityCard } from '../workspace/IdentityCard';
import type { IdentityCardAction } from '../workspace/IdentityCard';
import { SuspendIdentityDialog } from '../workspace/SuspendIdentityDialog';
import { RevokeIdentityDialog } from '../workspace/RevokeIdentityDialog';
import {
  getAgentIdentity,
  resumeAgentIdentity,
  archiveAgentIdentity,
  toggleAgentEmailSending,
} from '../../lib/api';
import type { AgentIdentity } from './types';

interface IdentityTabProps {
  agentId: string;
  onActionCompleted(): void | Promise<void>;
}

function extractApiError(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: { message?: string } | string; message?: string } }; message?: string };
  const apiErr = err.response?.data?.error;
  return (typeof apiErr === 'string' ? apiErr : apiErr?.message)
    ?? err.response?.data?.message
    ?? err.message
    ?? fallback;
}

export function IdentityTab({ agentId, onActionCompleted }: IdentityTabProps) {
  const [identity, setIdentity] = useState<AgentIdentity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [identityPending, setIdentityPending] = useState<IdentityCardAction | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);

  useEffect(() => {
    setIdentityLoading(true);
    getAgentIdentity(agentId)
      .then((data: AgentIdentity) => setIdentity(data))
      .catch(() => setIdentity(null))
      .finally(() => setIdentityLoading(false));
  }, [agentId]);

  async function runIdentityAction(action: IdentityCardAction, fn: () => Promise<unknown>) {
    setIdentityPending(action);
    setIdentityError(null);
    try {
      await fn();
      const updated: AgentIdentity = await getAgentIdentity(agentId);
      setIdentity(updated);
      await onActionCompleted();
    } catch (e: unknown) {
      setIdentityError(extractApiError(e, 'Action failed'));
    } finally {
      setIdentityPending(null);
    }
  }

  if (identityLoading) return <div className="text-[13px] text-slate-400">Loading…</div>;

  if (!identity) {
    return (
      <div className="text-[13px] text-slate-500">
        This agent has not been onboarded to the workplace yet.
      </div>
    );
  }

  return (
    <>
      <IdentityCard
        identity={{ ...identity, id: identity.identityId }}
        actor={{ displayName: identity.displayName, agentRole: null }}
        pendingAction={identityPending}
        actionError={identityError}
        onSuspend={() => { setIdentityError(null); setSuspendOpen(true); }}
        onResume={() => runIdentityAction('resume', () => resumeAgentIdentity(agentId))}
        onRevoke={() => { setIdentityError(null); setRevokeOpen(true); }}
        onArchive={() => runIdentityAction('archive', () => archiveAgentIdentity(agentId))}
        onToggleEmail={(enabled) => runIdentityAction('toggleEmail', () => toggleAgentEmailSending(agentId, enabled))}
      />
      <SuspendIdentityDialog
        open={suspendOpen}
        agentId={agentId}
        agentName={identity.displayName}
        onClose={() => setSuspendOpen(false)}
        onSuccess={async () => {
          const updated: AgentIdentity = await getAgentIdentity(agentId);
          setIdentity(updated);
        }}
      />
      <RevokeIdentityDialog
        open={revokeOpen}
        agentId={agentId}
        agentName={identity.displayName}
        onClose={() => setRevokeOpen(false)}
        onSuccess={async () => {
          const updated: AgentIdentity = await getAgentIdentity(agentId);
          setIdentity(updated);
        }}
      />
    </>
  );
}
