import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../lib/api';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { HelpHint } from '../components/ui/HelpHint';

// ---------------------------------------------------------------------------
// SubaccountKnowledgePage — Unified Knowledge page
// Spec: docs/onboarding-playbooks-spec.md §7.
//
// Two tabs on one page:
//   • References    — long-form notes (workspace_memory_entries).
//   • Memory Blocks — short stable facts loaded into every agent run.
//
// Promote (Reference → Block) is the headline affordance; Demote is the
// inverse for the Memory Blocks tab. Both routes hit the knowledge router
// and log Config History server-side.
// ---------------------------------------------------------------------------

interface Reference {
  id: string;
  content: string;
  entryType: string;
  createdAt: string;
}

interface MemoryBlock {
  id: string;
  name: string;
  content: string;
  subaccountId: string | null;
  sourceReferenceId: string | null;
  updatedAt: string;
}

type TabId = 'references' | 'blocks';

const MEMORY_BLOCK_LABEL_MAX = 80;
const MEMORY_BLOCK_CONTENT_MAX = 2000;
const REFERENCE_PROMOTE_PREVIEW_MAX = 500;
const inputCls =
  'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function SubaccountKnowledgePage({ user: _user }: { user: { id: string; role: string } }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [tab, setTab] = useState<TabId>('references');
  const [references, setReferences] = useState<Reference[]>([]);
  const [blocks, setBlocks] = useState<MemoryBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Promote modal state
  const [promoteFrom, setPromoteFrom] = useState<Reference | null>(null);
  const [promoteLabel, setPromoteLabel] = useState('');
  const [promoteContent, setPromoteContent] = useState('');
  const [promoting, setPromoting] = useState(false);

  // Create / edit Reference modal state
  const [editRef, setEditRef] = useState<Reference | 'new' | null>(null);
  const [editRefContent, setEditRefContent] = useState('');

  // Create / edit Block modal state
  const [editBlock, setEditBlock] = useState<MemoryBlock | 'new' | null>(null);
  const [editBlockLabel, setEditBlockLabel] = useState('');
  const [editBlockContent, setEditBlockContent] = useState('');

  // Delete confirmation
  const [deleteRefId, setDeleteRefId] = useState<string | null>(null);
  const [demoteBlockId, setDemoteBlockId] = useState<string | null>(null);

  useEffect(() => {
    if (!subaccountId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subaccountId]);

  async function load() {
    try {
      setLoading(true);
      const res = await api.get(`/api/subaccounts/${subaccountId}/knowledge`);
      setReferences(res.data.references ?? []);
      setBlocks(res.data.memoryBlocks ?? []);
    } catch {
      setError('Failed to load knowledge');
    } finally {
      setLoading(false);
    }
  }

  const filteredRefs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return references;
    return references.filter((r) => r.content.toLowerCase().includes(q));
  }, [references, search]);

  const filteredBlocks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return blocks;
    return blocks.filter(
      (b) =>
        b.name.toLowerCase().includes(q) || b.content.toLowerCase().includes(q),
    );
  }, [blocks, search]);

  function openPromote(ref: Reference) {
    setPromoteFrom(ref);
    setPromoteLabel('');
    setPromoteContent(ref.content.slice(0, REFERENCE_PROMOTE_PREVIEW_MAX));
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
      setTab('blocks');
      await load();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to promote';
      toast.error(msg);
    } finally {
      setPromoting(false);
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
      setTab('references');
      await load();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to demote';
      toast.error(msg);
    }
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
      await load();
    } catch {
      toast.error('Failed to save Reference');
    }
  }

  async function handleDeleteReference() {
    if (!deleteRefId) return;
    try {
      await api.delete(
        `/api/subaccounts/${subaccountId}/knowledge/references/${deleteRefId}`,
      );
      toast.success('Reference deleted');
      setDeleteRefId(null);
      await load();
    } catch {
      toast.error('Failed to delete Reference');
    }
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
      await load();
    } catch {
      toast.error('Failed to save Memory Block');
    }
  }

  function openEditReference(ref: Reference | 'new') {
    setEditRef(ref);
    setEditRefContent(ref === 'new' ? '' : ref.content);
  }

  function openEditBlock(block: MemoryBlock | 'new') {
    setEditBlock(block);
    setEditBlockLabel(block === 'new' ? '' : block.name);
    setEditBlockContent(block === 'new' ? '' : block.content);
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="h-48 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
      </div>
    );
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="mb-6">
        <Link
          to={`/admin/subaccounts/${subaccountId}`}
          className="text-[14px] text-indigo-600 hover:text-indigo-700 no-underline"
        >
          &larr; Back
        </Link>
        <div className="flex justify-between items-center mt-2">
          <div>
            <h1 className="text-[24px] font-bold text-slate-900 m-0">Knowledge</h1>
            <p className="text-[14px] text-slate-500 mt-1 m-0">
              References are long-form notes agents retrieve on demand. Memory Blocks are short
              stable facts loaded into every agent run.
            </p>
          </div>
          {tab === 'references' ? (
            <button
              onClick={() => openEditReference('new')}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              + New Reference
            </button>
          ) : (
            <button
              onClick={() => openEditBlock('new')}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              + New Memory Block
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg mb-4 text-[14px] flex justify-between items-center">
          {error}
          <button
            onClick={() => setError('')}
            className="bg-transparent border-0 cursor-pointer text-red-700 text-lg"
          >
            &times;
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 mb-4">
        <TabButton active={tab === 'references'} onClick={() => setTab('references')}>
          References ({references.length})
        </TabButton>
        <TabButton active={tab === 'blocks'} onClick={() => setTab('blocks')}>
          Memory Blocks ({blocks.length})
        </TabButton>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tab === 'references' ? 'Search references…' : 'Search memory blocks…'}
          className={inputCls}
        />
      </div>

      {tab === 'references' ? (
        <ReferencesTable
          items={filteredRefs}
          onPromote={openPromote}
          onEdit={(r) => openEditReference(r)}
          onDelete={(id) => setDeleteRefId(id)}
        />
      ) : (
        <BlocksTable
          items={filteredBlocks}
          onDemote={(id) => setDemoteBlockId(id)}
          onEdit={(b) => openEditBlock(b)}
        />
      )}

      {/* Promote modal */}
      {promoteFrom && (
        <Modal title="Promote to Memory Block" onClose={() => setPromoteFrom(null)} maxWidth={560}>
          <div className="flex flex-col gap-3.5">
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-[12px] text-slate-600 max-h-32 overflow-auto whitespace-pre-wrap">
              {promoteFrom.content.slice(0, 500)}
              {promoteFrom.content.length > 500 ? '…' : ''}
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
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-lg text-[14px] font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handlePromote}
                disabled={!promoteLabel.trim() || !promoteContent.trim() || promoting}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-[14px] font-semibold cursor-pointer"
              >
                {promoting ? 'Promoting…' : 'Promote'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reference create / edit modal */}
      {editRef && (
        <Modal
          title={editRef === 'new' ? 'New Reference' : 'Edit Reference'}
          onClose={() => {
            setEditRef(null);
            setEditRefContent('');
          }}
          maxWidth={640}
        >
          <div className="flex flex-col gap-3.5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Content *</label>
              <textarea
                value={editRefContent}
                onChange={(e) => setEditRefContent(e.target.value)}
                rows={14}
                className={`${inputCls} resize-vertical`}
                placeholder="Long-form notes, SOPs, brand docs, meeting summaries…"
              />
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => {
                  setEditRef(null);
                  setEditRefContent('');
                }}
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-lg text-[14px] font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveReference}
                disabled={!editRefContent.trim()}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-[14px] font-semibold cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Memory Block create / edit modal */}
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
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-lg text-[14px] font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveBlock}
                disabled={!editBlockLabel.trim() || !editBlockContent.trim()}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-[14px] font-semibold cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deleteRefId && (
        <ConfirmDialog
          title="Delete Reference"
          message="Are you sure? This cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDeleteReference}
          onCancel={() => setDeleteRefId(null)}
        />
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
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-[14px] font-medium border-b-2 transition-colors ${
        active
          ? 'border-indigo-600 text-indigo-700'
          : 'border-transparent text-slate-600 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}

function ReferencesTable({
  items,
  onPromote,
  onEdit,
  onDelete,
}: {
  items: Reference[];
  onPromote: (r: Reference) => void;
  onEdit: (r: Reference) => void;
  onDelete: (id: string) => void;
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
            {['Content', 'Type', 'Added', 'Actions'].map((h) => (
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
              <td className="px-3 py-3 text-[14px] text-slate-700 max-w-[640px]">
                <div className="line-clamp-3 whitespace-pre-wrap">{item.content}</div>
              </td>
              <td className="px-3 py-3 text-[13px] text-slate-500">{item.entryType}</td>
              <td className="px-3 py-3 text-[13px] text-slate-500">
                {new Date(item.createdAt).toLocaleDateString()}
              </td>
              <td className="px-3 py-3">
                <div className="flex gap-1.5">
                  <button
                    onClick={() => onPromote(item)}
                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded text-[12px] text-indigo-700 cursor-pointer transition-colors"
                  >
                    Promote
                  </button>
                  <button
                    onClick={() => onEdit(item)}
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded text-[12px] text-slate-700 cursor-pointer transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDelete(item.id)}
                    className="px-2.5 py-1 bg-red-50 hover:bg-red-100 border border-red-200 rounded text-[12px] text-red-600 cursor-pointer transition-colors"
                  >
                    Delete
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
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded text-[12px] text-slate-700 cursor-pointer transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDemote(item.id)}
                    className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded text-[12px] text-amber-700 cursor-pointer transition-colors"
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
