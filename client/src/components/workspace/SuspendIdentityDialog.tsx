import React from 'react';
import { suspendAgentIdentity } from '../../lib/api';

export function SuspendIdentityDialog({ open, agentId, agentName, onClose, onSuccess }: {
  open: boolean; agentId: string; agentName: string; onClose: () => void; onSuccess: () => void;
}) {
  if (!open) return null;
  const handleConfirm = async () => {
    await suspendAgentIdentity(agentId);
    onSuccess();
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold mb-2">Suspend {agentName}?</h2>
        <p className="text-sm text-gray-600 mb-4">Suspending immediately frees their seat and pauses email sending. You can resume them later.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
          <button onClick={handleConfirm} className="px-4 py-2 text-sm bg-amber-500 text-white rounded hover:bg-amber-600">Suspend</button>
        </div>
      </div>
    </div>
  );
}
