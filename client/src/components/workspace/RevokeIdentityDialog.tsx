import React, { useState } from 'react';
import { revokeAgentIdentity } from '../../lib/api';

export function RevokeIdentityDialog({ open, agentId, agentName, onClose, onSuccess }: {
  open: boolean; agentId: string; agentName: string; onClose: () => void; onSuccess: () => void;
}) {
  const [confirmName, setConfirmName] = useState('');
  if (!open) return null;
  const canRevoke = confirmName === agentName;
  const handleConfirm = async () => {
    if (!canRevoke) return;
    await revokeAgentIdentity(agentId, confirmName);
    onSuccess();
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold mb-2 text-red-600">Revoke {agentName}?</h2>
        <p className="text-sm text-gray-600 mb-3">Revoking is permanent for billing. Historical mail and audit are preserved. Type the agent's name to confirm.</p>
        <input
          className="block w-full border rounded px-3 py-2 text-sm mb-4"
          placeholder={agentName}
          value={confirmName}
          onChange={e => setConfirmName(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!canRevoke}
            className={`px-4 py-2 text-sm rounded text-white ${canRevoke ? 'bg-red-600 hover:bg-red-700' : 'bg-red-300 cursor-not-allowed'}`}
          >
            Revoke
          </button>
        </div>
      </div>
    </div>
  );
}
