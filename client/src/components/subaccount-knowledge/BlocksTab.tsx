import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import api from '../../lib/api';
import Modal from '../Modal';
import ConfirmDialog from '../ConfirmDialog';
import type { MemoryBlock } from './types';
import { MEMORY_BLOCK_LABEL_MAX, MEMORY_BLOCK_CONTENT_MAX, inputCls } from './types';

interface Props {
  subaccountId: string;
  items: MemoryBlock[];
  search: string;
  openCreateOnMount: boolean;
  onCreateConsumed(): void;
  onMutated(): Promise<void>;
  onTabSwitchTo(next: 'references'): void;
}

export function BlocksTab({
  subaccountId,
  items,
  search,
  openCreateOnMount,
  onCreateConsumed,
  onMutated,
  onTabSwitchTo,
}: Props) {
  const [editBlock, setEditBlock] = useState<MemoryBlock | 'new' | null>(null);
  const [editBlockLabel, setEditBlockLabel] = useState('');
  const [editBlockContent, setEditBlockContent] = useState('');
  const [demoteBlockId, setDemoteBlockId] = useState<string | null>(null);

  useEffect(() => {
    if (openCreateOnMount) {
      openEditBlock('new');
      onCreateConsumed();
    }
  }, [openCreateOnMount, onCreateConsumed]);

  const filteredBlocks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (b) =>
        b.name.toLowerCase().includes(q) || b.content.toLowerCase().includes(q),
    );
  }, [items, search]);

  function openEditBlock(block: MemoryBlock | 'new') {
    setEditBlock(block);
    setEditBlockLabel(block === 'new' ? '' : block.name);
    setEditBlockContent(block === 'new' ? '' : block.content);
  }

  async function handleSaveBlock() {
    if (!editBlock) return;
    const label = editBlockLabel.trim();
    const content = editBlockContent.trim();
    if (!label || !content) return;
    try {
      if (editBlock === 'new') {
        await api.post(`/api/memory-blocks`, {
          name: label,
          content,
          subaccountId,
          isReadOnly: false,
        });
        toast.success('Memory Block created');
      } else {
        await api.patch(`/api/memory-blocks/${editBlock.id}`, {
          name: label,
          content,
        });
        toast.success('Memory Block updated');
      }
      setEditBlock(null);
      setEditBlockLabel('');
      setEditBlockContent('');
      await onMutated();
    } catch {
      toast.error('Failed to save Memory Block');
    }
  }

  async function handleDemote() {
    if (!demoteBlockId) return;
    try {
      await api.post(
        `/api/subaccounts/${subaccountId}/knowledge/memory-blocks/${demoteBlockId}/demote`,
        {},
      );
      toast.success('Memory Block demoted to Reference');
      setDemoteBlockId(null);
      await onMutated();
      onTabSwitchTo('references');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to demote';
      toast.error(msg);
    }
  }

  return (
    <>
      <BlocksTable
        items={filteredBlocks}
        onDemote={(id) => setDemoteBlockId(id)}
        onEdit={(b) => openEditBlock(b)}
      />

      {editBlock && (
        <Modal
          title={editBlock === 'new' ? 'New Memory Block' : 'Edit Memory Block'}
          onClose={() => {
            setEditBlock(null);
            setEditBlockLabel('');
            setEditBlockContent('');
          }}
          maxWidth={560}
        >
          <div className="flex flex-col gap-3.5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Label *</label>
              <input
                value={editBlockLabel}
                maxLength={MEMORY_BLOCK_LABEL_MAX}
                onChange={(e) => setEditBlockLabel(e.target.value)}
                className={inputCls}
              />
              <div className="text-[11px] text-slate-500 mt-1">
                {editBlockLabel.length}/{MEMORY_BLOCK_LABEL_MAX}
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Content *</label>
              <textarea
                value={editBlockContent}
                maxLength={MEMORY_BLOCK_CONTENT_MAX}
                onChange={(e) => setEditBlockContent(e.target.value)}
                rows={8}
                className={`${inputCls} resize-vertical font-mono text-[12px]`}
              />
              <div className="text-[11px] text-slate-500 mt-1">
                {editBlockContent.length}/{MEMORY_BLOCK_CONTENT_MAX}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => {
                  setEditBlock(null);
                  setEditBlockLabel('');
                  setEditBlockContent('');
                }}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveBlock}
                disabled={!editBlockLabel.trim() || !editBlockContent.trim()}
                className="btn btn-primary"
              >
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}

      {demoteBlockId && (
        <ConfirmDialog
          title="Demote to Reference"
          message="The block is archived and its content moves into References. Agents stop loading it automatically on every run."
          confirmLabel="Demote"
          onConfirm={handleDemote}
          onCancel={() => setDemoteBlockId(null)}
        />
      )}
    </>
  );
}

function BlocksTable({
  items,
  onDemote,
  onEdit,
}: {
  items: MemoryBlock[];
  onDemote: (id: string) => void;
  onEdit: (b: MemoryBlock) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="py-16 text-center text-slate-400">
        <p className="text-[16px] mb-2">No memory blocks yet</p>
        <p className="text-[14px]">Promote a Reference or create one manually.</p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {['Label', 'Content', 'Source', 'Updated', 'Actions'].map((h) => (
              <th
                key={h}
                className="text-left px-3 py-2.5 text-[12px] font-semibold text-slate-500 uppercase tracking-wide"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-slate-50 transition-colors align-top">
              <td className="px-3 py-3 text-[14px] font-medium text-slate-800">{item.name}</td>
              <td className="px-3 py-3 text-[13px] text-slate-600 max-w-[520px]">
                <div className="line-clamp-3 whitespace-pre-wrap">{item.content}</div>
              </td>
              <td className="px-3 py-3 text-[13px] text-slate-500">
                {item.sourceReferenceId ? 'From Reference' : 'Manual'}
              </td>
              <td className="px-3 py-3 text-[13px] text-slate-500">
                {new Date(item.updatedAt).toLocaleDateString()}
              </td>
              <td className="px-3 py-3">
                <div className="flex gap-1.5">
                  <button
                    onClick={() => onEdit(item)}
                    className="btn btn-xs btn-secondary"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDemote(item.id)}
                    className="btn btn-xs btn-ghost text-amber-700 hover:bg-amber-50"
                  >
                    Demote
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
