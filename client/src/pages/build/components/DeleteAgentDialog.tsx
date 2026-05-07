import React, { useState } from 'react';
import Modal from '../../../components/Modal';

interface DeleteAgentDialogProps {
  agentId: string;
  agentName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteAgentDialog({ agentId: _agentId, agentName, onConfirm, onCancel }: DeleteAgentDialogProps) {
  const [typed, setTyped] = useState('');
  const confirmed = typed.trim() === agentName.trim();

  return (
    <Modal title="Delete agent" onClose={onCancel} maxWidth={480}>
      <p className="text-sm text-slate-600 mb-4">
        This action is permanent and cannot be undone. Type <strong>{agentName}</strong> to confirm.
      </p>
      <input
        type="text"
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md mb-4"
        placeholder={agentName}
        value={typed}
        onChange={e => setTyped(e.target.value)}
        autoFocus
      />
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="btn btn-secondary">Cancel</button>
        <button onClick={onConfirm} disabled={!confirmed} className="btn btn-danger">Delete agent</button>
      </div>
    </Modal>
  );
}
