// client/src/pages/govern/components/DisconnectConfirmDialog.tsx
// Spec: tasks/builds/consolidation-govern/spec.md §4.10, §4.13

import { useEffect, useState } from 'react';
import Modal from '../../../components/Modal';
import { getConnectionUsage } from '../../../api/governApi';
import type { Connection, ConnectionUsage } from '../../../../../shared/types/govern.js';

interface Props {
  connection: Connection;
  onClose: () => void;
  onDisconnected: () => void;
}

export function DisconnectConfirmDialog({ connection, onClose, onDisconnected }: Props) {
  const [usage, setUsage] = useState<ConnectionUsage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  useEffect(() => {
    getConnectionUsage(connection.id)
      .then(setUsage)
      .catch(() => setLoadError('Failed to load usage information.'));
  }, [connection.id]);

  const impactCount = usage
    ? usage.agents.length + usage.recurringTasks.length + usage.workflows.length
    : 0;

  const canConfirm = usage !== null && (impactCount === 0 || confirmText === 'disconnect');

  async function handleDisconnect() {
    if (!canConfirm || busy) return;
    setBusy(true);
    setDisconnectError(null);
    try {
      const res = await fetch(`/api/connections/${encodeURIComponent(connection.id)}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      onDisconnected();
    } catch (e: unknown) {
      setDisconnectError(e instanceof Error ? e.message : 'Disconnect failed.');
      setBusy(false);
    }
  }

  return (
    <Modal title="Disconnect integration" onClose={onClose} maxWidth={480}>
      <p className="text-sm text-slate-600 mb-4 leading-relaxed">
        Disconnecting this integration will remove access for all agents and automations using it.
        This cannot be undone.
      </p>

      {loadError && (
        <p className="text-sm text-red-600 mb-4">{loadError}</p>
      )}

      {usage !== null && (
        <div className="mb-4">
          {impactCount > 0 ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              {usage.agents.length > 0 && (
                <div>{usage.agents.length} agent{usage.agents.length !== 1 ? 's' : ''}</div>
              )}
              {usage.recurringTasks.length > 0 && (
                <div>{usage.recurringTasks.length} task{usage.recurringTasks.length !== 1 ? 's' : ''}</div>
              )}
              {usage.workflows.length > 0 && (
                <div>{usage.workflows.length} workflow{usage.workflows.length !== 1 ? 's' : ''}</div>
              )}
              <div className="mt-1 font-medium">use this connection and will lose access.</div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No agents or automations currently use this connection.</p>
          )}
        </div>
      )}

      {usage !== null && impactCount > 0 && (
        <div className="mb-4">
          <label htmlFor="disconnect-confirm" className="block text-sm font-medium text-slate-700 mb-1.5">
            Type &quot;disconnect&quot; to confirm
          </label>
          <input
            id="disconnect-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder='Type "disconnect" to confirm'
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          />
        </div>
      )}

      {disconnectError && (
        <p className="text-sm text-red-600 mb-3">{disconnectError}</p>
      )}

      <div className="flex gap-2.5 justify-end">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center px-[18px] py-[9px] text-[13px] font-semibold rounded-lg border-0 cursor-pointer transition-all duration-150 font-[inherit] tracking-tight bg-slate-100 text-gray-700 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={!canConfirm || busy}
          className="inline-flex items-center px-[18px] py-[9px] text-[13px] font-semibold rounded-lg border-0 cursor-pointer transition-all duration-150 font-[inherit] tracking-tight bg-gradient-to-br from-red-500 to-red-600 text-white shadow-[0_1px_4px_rgba(239,68,68,0.35)] hover:from-red-600 hover:to-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Disconnecting...' : 'Disconnect'}
        </button>
      </div>
    </Modal>
  );
}
