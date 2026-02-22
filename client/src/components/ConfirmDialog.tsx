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
      <p style={{ fontSize: 14, color: '#374151', margin: '0 0 24px', lineHeight: 1.5 }}>{message}</p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          style={{ padding: '8px 20px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
