import React, { useState } from 'react';
import Modal from '../../../components/Modal';
import api from '../../../lib/api';

interface DeleteProjectDialogProps {
  projectId: string;
  projectName: string;
  linkedAgentCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteProjectDialog({ projectId, projectName, linkedAgentCount, onConfirm, onCancel }: DeleteProjectDialogProps) {
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const needsConfirm = linkedAgentCount > 0;
  const confirmed = !needsConfirm || typed.trim() === projectName.trim();

  return (
    <Modal title="Delete project" onClose={onCancel} maxWidth={480}>
      <p className="text-sm text-slate-600 mb-4">
        {needsConfirm
          ? `This project has ${linkedAgentCount} linked agent${linkedAgentCount !== 1 ? 's' : ''}. Type "${projectName}" to confirm deletion.`
          : `Are you sure you want to delete "${projectName}"? This cannot be undone.`}
      </p>
      {needsConfirm && (
        <input
          type="text"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md mb-4"
          placeholder={projectName}
          value={typed}
          onChange={e => setTyped(e.target.value)}
          autoFocus
        />
      )}
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="btn btn-secondary">Cancel</button>
        <button
          onClick={async () => {
            if (!confirmed) return;
            setDeleting(true);
            try {
              await api.delete(`/api/projects/${projectId}`);
              onConfirm();
            } finally {
              setDeleting(false);
            }
          }}
          disabled={!confirmed || deleting}
          className="btn btn-danger"
        >
          {deleting ? 'Deleting...' : 'Delete project'}
        </button>
      </div>
    </Modal>
  );
}
