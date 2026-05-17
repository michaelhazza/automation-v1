import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import api from '../../lib/api';
import Modal from '../Modal';
import ConfirmDialog from '../ConfirmDialog';
import { HelpHint } from '../ui/HelpHint';
import RichTextEditor from '../RichTextEditor';
import { referenceTitle, referencePreview } from './format';
import { RenameReferenceModal } from './RenameReferenceModal';
import type { Reference } from './types';
import { MEMORY_BLOCK_LABEL_MAX, MEMORY_BLOCK_CONTENT_MAX, REFERENCE_PROMOTE_PREVIEW_MAX, inputCls } from './types';

interface Props {
  subaccountId: string;
  items: Reference[];
  search: string;
  openCreateOnMount: boolean;
  onCreateConsumed(): void;
  onMutated(): Promise<void>;
  onTabSwitchTo(next: 'blocks'): void;
}

export function ReferencesTab({
  subaccountId,
  items,
  search,
  openCreateOnMount,
  onCreateConsumed,
  onMutated,
  onTabSwitchTo,
}: Props) {
  const [editRef, setEditRef] = useState<Reference | 'new' | null>(null);
  const [editRefContent, setEditRefContent] = useState('');

  const [promoteFrom, setPromoteFrom] = useState<Reference | null>(null);
  const [promoteLabel, setPromoteLabel] = useState('');
  const [promoteContent, setPromoteContent] = useState('');
  const [promoting, setPromoting] = useState(false);

  const [renameRef, setRenameRef] = useState<Reference | null>(null);

  const [archiveRefId, setArchiveRefId] = useState<string | null>(null);

  useEffect(() => {
    if (openCreateOnMount) {
      openEditReference('new');
      onCreateConsumed();
    }
  }, [openCreateOnMount, onCreateConsumed]);

  const filteredRefs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((r) => r.content.toLowerCase().includes(q));
  }, [items, search]);

  function openEditReference(ref: Reference | 'new') {
    setEditRef(ref);
    setEditRefContent(ref === 'new' ? '' : ref.content);
  }

  function openPromote(ref: Reference) {
    setPromoteFrom(ref);
    setPromoteLabel(referenceTitle(ref.content));
    // Memory Blocks are plain text (spec §7.3) — strip HTML from the source
    // Reference before seeding the promote modal so the user edits a clean
    // starting point.
    const plain = ref.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    setPromoteContent(plain.slice(0, REFERENCE_PROMOTE_PREVIEW_MAX));
  }

  async function handleSaveReference() {
    if (!editRef) return;
    const content = editRefContent.trim();
    if (!content) return;
    try {
      if (editRef === 'new') {
        await api.post(`/api/subaccounts/${subaccountId}/knowledge/references`, { content });
        toast.success('Reference created');
      } else {
        await api.patch(
          `/api/subaccounts/${subaccountId}/knowledge/references/${editRef.id}`,
          { content },
        );
        toast.success('Reference updated');
      }
      setEditRef(null);
      setEditRefContent('');
      await onMutated();
    } catch {
      toast.error('Failed to save Reference');
    }
  }

  async function handlePromote() {
    if (!promoteFrom) return;
    if (!promoteLabel.trim() || !promoteContent.trim()) return;
    try {
      setPromoting(true);
      await api.post(
        `/api/subaccounts/${subaccountId}/knowledge/references/${promoteFrom.id}/promote`,
        { label: promoteLabel.trim(), content: promoteContent.trim() },
      );
      toast.success('Reference promoted to Memory Block');
      setPromoteFrom(null);
      await onMutated();
      onTabSwitchTo('blocks');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to promote';
      toast.error(msg);
    } finally {
      setPromoting(false);
    }
  }

  async function handleArchiveReference() {
    if (!archiveRefId) return;
    try {
      await api.delete(
        `/api/subaccounts/${subaccountId}/knowledge/references/${archiveRefId}`,
      );
      toast.success('Reference archived');
      setArchiveRefId(null);
      await onMutated();
    } catch {
      toast.error('Failed to archive Reference');
    }
  }

  return (
    <>
      <ReferencesTable
        items={filteredRefs}
        onPromote={openPromote}
        onEdit={(r) => openEditReference(r)}
        onRename={(r) => setRenameRef(r)}
        onArchive={(id) => setArchiveRefId(id)}
      />

      {/* Promote modal */}
      {promoteFrom && (
        <Modal title="Promote to Memory Block" onClose={() => setPromoteFrom(null)} maxWidth={560}>
          <div className="flex flex-col gap-3.5">
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-[12px] text-slate-600 max-h-32 overflow-auto">
              {referencePreview(promoteFrom.content).slice(0, 500)}
              {referencePreview(promoteFrom.content).length > 500 ? '…' : ''}
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1 flex items-center gap-1">
                <span>Block label *</span>
                <HelpHint text="Promoting copies this reference into a Memory Block. Blocks are loaded into every agent run — use for stable facts." />
              </label>
              <input
                value={promoteLabel}
                maxLength={MEMORY_BLOCK_LABEL_MAX}
                onChange={(e) => setPromoteLabel(e.target.value)}
                className={inputCls}
                placeholder="e.g. Brand voice"
              />
              <div className="text-[11px] text-slate-500 mt-1">
                {promoteLabel.length}/{MEMORY_BLOCK_LABEL_MAX}
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Condensed content *
              </label>
              <textarea
                value={promoteContent}
                maxLength={MEMORY_BLOCK_CONTENT_MAX}
                onChange={(e) => setPromoteContent(e.target.value)}
                rows={8}
                className={`${inputCls} resize-vertical font-mono text-[12px]`}
              />
              <div className="text-[11px] text-slate-500 mt-1">
                {promoteContent.length}/{MEMORY_BLOCK_CONTENT_MAX}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => setPromoteFrom(null)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handlePromote}
                disabled={!promoteLabel.trim() || !promoteContent.trim() || promoting}
                className="btn btn-primary"
              >
                {promoting ? 'Promoting…' : 'Promote'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reference create / edit modal (Tiptap — spec §7 G6.2) */}
      {editRef && (
        <Modal
          title={editRef === 'new' ? 'New Reference' : 'Edit Reference'}
          onClose={() => {
            setEditRef(null);
            setEditRefContent('');
          }}
          maxWidth={720}
        >
          <div className="flex flex-col gap-3.5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Content *</label>
              <RichTextEditor
                value={editRefContent}
                onChange={setEditRefContent}
                placeholder="Long-form notes, SOPs, brand docs, meeting summaries…"
                minHeight={320}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => {
                  setEditRef(null);
                  setEditRefContent('');
                }}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveReference}
                disabled={!editRefContent.replace(/<[^>]+>/g, '').trim()}
                className="btn btn-primary"
              >
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}

      {renameRef && (
        <RenameReferenceModal
          subaccountId={subaccountId}
          reference={renameRef}
          initialTitle={referenceTitle(renameRef.content)}
          onClose={() => setRenameRef(null)}
          onRenamed={onMutated}
        />
      )}

      {archiveRefId && (
        <ConfirmDialog
          title="Archive Reference"
          message="The Reference is hidden from the Knowledge page and excluded from agent memory searches. It can be restored later."
          confirmLabel="Archive"
          onConfirm={handleArchiveReference}
          onCancel={() => setArchiveRefId(null)}
        />
      )}
    </>
  );
}

function ReferencesTable({
  items,
  onPromote,
  onEdit,
  onRename,
  onArchive,
}: {
  items: Reference[];
  onPromote: (r: Reference) => void;
  onEdit: (r: Reference) => void;
  onRename: (r: Reference) => void;
  onArchive: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="py-16 text-center text-slate-400">
        <p className="text-[16px] mb-2">No references yet</p>
        <p className="text-[14px]">Add long-form notes agents can retrieve on demand.</p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {['Title', 'Preview', 'Type', 'Added', 'Actions'].map((h) => (
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
              <td className="px-3 py-3 text-[14px] font-medium text-slate-800 max-w-[220px]">
                <div className="truncate" title={referenceTitle(item.content)}>
                  {referenceTitle(item.content)}
                </div>
              </td>
              <td className="px-3 py-3 text-[13px] text-slate-600 max-w-[480px]">
                <div className="line-clamp-2">{referencePreview(item.content)}</div>
              </td>
              <td className="px-3 py-3 text-[13px] text-slate-500">{item.entryType}</td>
              <td className="px-3 py-3 text-[13px] text-slate-500">
                {new Date(item.createdAt).toLocaleDateString()}
              </td>
              <td className="px-3 py-3">
                <div className="flex gap-1.5 flex-wrap">
                  <button
                    onClick={() => onPromote(item)}
                    className="btn btn-xs btn-ghost text-indigo-700 hover:bg-indigo-50"
                  >
                    Promote
                  </button>
                  <button
                    onClick={() => onEdit(item)}
                    className="btn btn-xs btn-secondary"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onRename(item)}
                    className="btn btn-xs btn-secondary"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => onArchive(item.id)}
                    className="btn btn-xs btn-ghost text-amber-700 hover:bg-amber-50"
                  >
                    Archive
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
