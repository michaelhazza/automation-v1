import Modal from './Modal';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onCancel} maxWidth={400}>
      <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 24px', lineHeight: 1.6 }}>{message}</p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          className="btn btn-secondary"
          style={{ fontSize: 13 }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="btn"
          style={{ fontSize: 13, background: 'linear-gradient(135deg, #ef4444, #dc2626)', color: '#fff', boxShadow: '0 1px 4px rgba(239,68,68,0.35)' }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
