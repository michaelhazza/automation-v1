// client/src/pages/govern/components/AiSubscriptionDetailModal.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §Chunk 7

import { useState } from 'react';
import Modal from '../../../components/Modal';
import type { AiSubscriptionConnection } from '../../../../../shared/types/govern.js';
import { disconnectAiSubscription } from '../../../api/governApi';
import { MakeDefaultConfirmModal } from './MakeDefaultConfirmModal';
import { SignInAgainModal } from './SignInAgainModal';
import { EditAvailabilityModal } from './EditAvailabilityModal';
import { formatRelative } from './_utils';
import { StatusPill, TierBadge } from './_aiSubscriptionPills';

interface Props {
  subaccountId: string;
  connection: AiSubscriptionConnection;
  onClose: () => void;
  onUpdated: () => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

type SubModal = 'make_default' | 'sign_in_again' | 'edit_availability' | null;

export function AiSubscriptionDetailModal({ subaccountId, connection: initialConnection, onClose, onUpdated }: Props) {
  const [conn] = useState(initialConnection);
  const [subModal, setSubModal] = useState<SubModal>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTerminal = conn.usabilityState === 'revoked' || conn.usabilityState === 'disabled';
  const canSignIn = ['connected_usable', 'connected_needs_consent', 'connected_needs_reauth'].includes(conn.usabilityState);
  const canMakeDefault = !conn.isDefault && !isTerminal && conn.usabilityState !== 'connected_unverified';

  async function handleDisconnect() {
    if (!window.confirm(`Disconnect "${conn.label ?? conn.provider}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await disconnectAiSubscription(subaccountId, conn.id);
      onUpdated();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      setError(msg ?? (e instanceof Error ? e.message : 'Disconnect failed.'));
      setBusy(false);
    }
  }

  return (
    <>
      <Modal title={conn.label ?? conn.provider} onClose={onClose} maxWidth={620}>
        {/* Header: identity */}
        <div className="flex items-center gap-3.5 pb-4 border-b border-slate-100 mb-4">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${isTerminal ? 'bg-slate-100' : 'bg-emerald-50'}`}>
            <svg width="22" height="22" fill="none" stroke={isTerminal ? '#94a3b8' : '#047857'} strokeWidth="1.5" viewBox="0 0 24 24">
              <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[17px] font-bold text-slate-900">{conn.label ?? `${conn.provider} ${conn.planTier}`}</span>
              {conn.isDefault && (
                <span className="inline-flex text-[10.5px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-300 px-2 py-0.5 rounded">
                  Default
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <TierBadge tier={conn.planTier} />
              <StatusPill row={conn} />
            </div>
          </div>
        </div>

        {/* Metadata strip */}
        <div className="flex items-center gap-4 flex-wrap pb-4 border-b border-slate-100 mb-4 text-[12px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            {conn.user.displayName ?? 'Unknown'}
          </span>
          <span>Connected: {formatDate(conn.createdAt)}</span>
          <span>Last refresh: {formatRelative(conn.lastRefreshedAt)}</span>
          <span>Provider: {conn.provider}</span>
        </div>

        {/* Default section */}
        {conn.isDefault ? (
          <div className="flex items-center justify-between p-3.5 bg-indigo-50 border border-indigo-200 rounded-lg mb-4">
            <div>
              <div className="text-[13px] font-semibold text-indigo-800">Default subscription</div>
              <div className="text-[12px] text-indigo-600 mt-0.5">Agents use this first when they run.</div>
            </div>
          </div>
        ) : !isTerminal ? (
          <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg mb-4">
            <div className="text-[13px] text-slate-600">Not the default subscription</div>
            {canMakeDefault && (
              <button
                type="button"
                onClick={() => setSubModal('make_default')}
                className="text-[12.5px] font-semibold text-indigo-600 hover:text-indigo-800 bg-transparent border-0 cursor-pointer font-[inherit]"
              >
                Make default
              </button>
            )}
            {conn.usabilityState === 'connected_unverified' && (
              <span className="text-[11px] text-slate-400 italic">Pending verification</span>
            )}
          </div>
        ) : null}

        {/* Availability */}
        <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg mb-4">
          <div>
            <div className="text-[13px] font-semibold text-slate-800">
              Available to: {conn.availabilityScope === 'all_agents' ? 'All agents' : `${conn.allowedAgentIds?.length ?? 0} specific agents`}
            </div>
            {conn.availabilityScope === 'specific_agents' && conn.allowedAgentIds && conn.allowedAgentIds.length > 0 && (
              <div className="text-[11.5px] text-slate-500 mt-0.5">{conn.allowedAgentIds.length} agent{conn.allowedAgentIds.length !== 1 ? 's' : ''} allowed</div>
            )}
          </div>
          {!isTerminal && (
            <button
              type="button"
              onClick={() => setSubModal('edit_availability')}
              className="text-[12.5px] font-semibold text-indigo-600 hover:text-indigo-800 bg-transparent border-0 cursor-pointer font-[inherit]"
            >
              Edit availability
            </button>
          )}
        </div>

        {/* Usage placeholder */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg mb-4 text-[13px] text-slate-500">
          No agents are using this yet. Autonomous agents (the long-running ones) ship soon.
        </div>

        {error && <p className="text-[12px] text-red-600 mb-3">{error}</p>}

        {/* Action buttons: only for non-terminal */}
        {!isTerminal && (
          <div className="flex flex-col gap-2 mb-4">
            {canSignIn && (
              <button
                type="button"
                onClick={() => setSubModal('sign_in_again')}
                className="flex items-center gap-2.5 px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 hover:border-slate-300 text-[13px] font-medium text-slate-700 cursor-pointer font-[inherit] transition-colors text-left"
              >
                <span className="text-base opacity-75">&#8635;</span>
                Sign in again
              </button>
            )}
            {!conn.isDefault && canMakeDefault && (
              <button
                type="button"
                onClick={() => setSubModal('make_default')}
                className="flex items-center gap-2.5 px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 hover:border-slate-300 text-[13px] font-medium text-slate-700 cursor-pointer font-[inherit] transition-colors text-left"
              >
                <span className="text-base opacity-75">&#11088;</span>
                Make default
              </button>
            )}
            <button
              type="button"
              onClick={() => setSubModal('edit_availability')}
              className="flex items-center gap-2.5 px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 hover:border-slate-300 text-[13px] font-medium text-slate-700 cursor-pointer font-[inherit] transition-colors text-left"
            >
              <span className="text-base opacity-75">&#128101;</span>
              Edit availability
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="flex items-center gap-2.5 px-3.5 py-2.5 border border-red-200 rounded-lg bg-white hover:bg-red-50 hover:border-red-300 text-[13px] font-medium text-red-600 cursor-pointer font-[inherit] transition-colors text-left disabled:opacity-50"
            >
              <span className="text-base opacity-75">&#8856;</span>
              Disconnect
            </button>
          </div>
        )}

        {/* V1: Agent use pause/resume deferred — no pause endpoint in V1.
            Re-enable when POST .../:connId/pause and POST .../:connId/resume routes ship.
            The "Turn off agent use" spec action maps to a future lifecycle state. */}
      </Modal>

      {/* Sub-modals */}
      {subModal === 'make_default' && (
        <MakeDefaultConfirmModal
          subaccountId={subaccountId}
          connection={conn}
          onClose={() => setSubModal(null)}
          onConfirmed={() => { setSubModal(null); onUpdated(); }}
        />
      )}
      {subModal === 'sign_in_again' && (
        <SignInAgainModal
          subaccountId={subaccountId}
          connection={conn}
          onClose={() => setSubModal(null)}
          onDone={() => { setSubModal(null); onUpdated(); }}
        />
      )}
      {subModal === 'edit_availability' && (
        <EditAvailabilityModal
          subaccountId={subaccountId}
          connection={conn}
          onClose={() => setSubModal(null)}
          onSaved={() => { setSubModal(null); onUpdated(); }}
        />
      )}
    </>
  );
}
