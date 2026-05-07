import React from 'react';
import ConfirmDialog from '../../../components/ConfirmDialog';

interface DeleteAgentDialogProps {
  agentId: string;
  agentName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteAgentDialog({ agentId: _agentId, agentName, onConfirm, onCancel }: DeleteAgentDialogProps) {
  return (
    <ConfirmDialog
      title="Delete agent"
      message={`Are you sure you want to delete "${agentName}"? This action cannot be undone.`}
      confirmLabel="Delete agent"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
