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
      <p className="text-sm text-slate-500 mt-0 mb-6 leading-relaxed">{message}</p>
      <div className="flex gap-2.5 justify-end">
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 px-[18px] py-[9px] text-[13px] font-semibold rounded-lg border-0 cursor-pointer transition-all duration-150 font-[inherit] tracking-tight bg-slate-100 text-gray-700 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="inline-flex items-center gap-1.5 px-[18px] py-[9px] text-[13px] font-semibold rounded-lg border-0 cursor-pointer transition-all duration-150 font-[inherit] tracking-tight bg-gradient-to-br from-red-500 to-red-600 text-white shadow-[0_1px_4px_rgba(239,68,68,0.35)] hover:from-red-600 hover:to-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
