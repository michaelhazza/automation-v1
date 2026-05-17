import { useState } from 'react';
import { toast } from 'sonner';
import api from '../../lib/api';
import Modal from '../Modal';
import { renameReferenceHtml } from './format';
import { inputCls } from './types';
import type { Reference } from './types';

interface Props {
  subaccountId: string;
  reference: Reference;
  initialTitle: string;
  onClose(): void;
  onRenamed(): Promise<void>;
}

export function RenameReferenceModal({ subaccountId, reference, initialTitle, onClose, onRenamed }: Props) {
  const [title, setTitle] = useState(initialTitle);

  async function handleRename() {
    const next = title.trim();
    if (!next) return;
    try {
      const nextHtml = renameReferenceHtml(reference.content, next);
      await api.patch(
        `/api/subaccounts/${subaccountId}/knowledge/references/${reference.id}`,
        { content: nextHtml },
      );
      toast.success('Reference renamed');
      onClose();
      await onRenamed();
    } catch {
      toast.error('Failed to rename Reference');
    }
  }

  return (
    <Modal title="Rename Reference" onClose={onClose} maxWidth={480}>
      <div className="flex flex-col gap-3.5">
        <div>
          <label className="block text-[13px] font-medium text-slate-700 mb-1">Title *</label>
          <input
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            className={inputCls}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleRename} disabled={!title.trim()} className="btn btn-primary">Rename</button>
        </div>
      </div>
    </Modal>
  );
}
