import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../lib/api';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { HelpHint } from '../components/ui/HelpHint';
import RichTextEditor from '../components/RichTextEditor';

/**
 * Extract a plain-text title from Tiptap HTML / plain text. Used for table
 * previews and the "Rename" affordance (first non-empty line = title).
 */
function referenceTitle(content: string): string {
  const stripped = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!stripped) return 'Untitled';
  const firstLine = stripped.split('\n')[0];
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

function referencePreview(content: string): string {
  const stripped = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (stripped.length <= 200) return stripped;
  return `${stripped.slice(0, 200)}…`;
}

/**
 * Rename a Reference by replacing its first <h1> (or falling back to
 * prepending one) with the new title. Used by the Rename modal so the
 * first-line-as-title convention stays consistent across the UI.
 */
function renameReferenceHtml(currentHtml: string, newTitle: string): string {
  const safe = newTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
  if (!safe) return currentHtml;
  const match = currentHtml.match(/^<h1[^>]*>.*?<\/h1>/i);
  if (match) {
    return currentHtml.replace(match[0], `<h1>${safe}</h1>`);
  }
  return `<h1>${safe}</h1>${currentHtml}`;
}

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

interface Insight {
  id: string;
  content: string;
  entryType: string;
  domain: string | null;
  topic: string | null;
  taskSlug: string | null;
  qualityScore: number | null;
  createdAt: string;
  agentRunId: string | null;
  agentId: string | null;
  agentName: string | null;
  runStatus: string | null;
  runStartedAt: string | null;
}

interface InsightFacets {
  domains: string[];
  topics: string[];
  entryTypes: string[];
  taskSlugs: string[];
}

interface MemoryBlock {
  id: string;
  name: string;
  content: string;
  subaccountId: string | null;
  sourceReferenceId: string | null;
  updatedAt: string;
}

type TabId = 'references' | 'insights' | 'blocks';

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
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightFacets, setInsightFacets] = useState<InsightFacets>({
    domains: [],
    topics: [],
    entryTypes: [],
    taskSlugs: [],
  });
  const [insightFilters, setInsightFilters] = useState<{
    domain: string;
    topic: string;
    entryType: string;
    taskSlug: string;
  }>({ domain: '', topic: '', entryType: '', taskSlug: '' });
  const [insightsLoading, setInsightsLoading] = useState(false);
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

  // Archive (soft-delete) confirmation
  const [archiveRefId, setArchiveRefId] = useState<string | null>(null);
  const [demoteBlockId, setDemoteBlockId] = useState<string | null>(null);

  // Rename modal state
  const [renameRef, setRenameRef] = useState<Reference | null>(null);
  const [renameTitle, setRenameTitle] = useState('');

  useEffect(() => {
    if (!subaccountId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subaccountId]);

  useEffect(() => {
    if (!subaccountId || tab !== 'insights') return;
    loadInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subaccountId, tab, insightFilters]);

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

  async function loadInsights() {
    try {
      setInsightsLoading(true);
      const params = new URLSearchParams();
      if (insightFilters.domain) params.set('domain', insightFilters.domain);
      if (insightFilters.topic) params.set('topic', insightFilters.topic);
      if (insightFilters.entryType) params.set('entryType', insightFilters.entryType);
      if (insightFilters.taskSlug) params.set('taskSlug', insightFilters.taskSlug);
      const qs = params.toString();
      const res = await api.get(
        `/api/subaccounts/${subaccountId}/knowledge/insights${qs ? `?${qs}` : ''}`,
      );
      setInsights(res.data.insights ?? []);
      setInsightFacets(
        res.data.facets ?? { domains: [], topics: [], entryTypes: [], taskSlugs: [] },
      );
    } catch {
      toast.error('Failed to load insights');
    } finally {
      setInsightsLoading(false);
    }
  }

  async function handlePromoteInsight(insightId: string) {
    try {
      await api.post(
        `/api/subaccounts/${subaccountId}/knowledge/insights/${insightId}/promote-to-reference`,
        {},
      );
      toast.success('Insight promoted to Reference');
      setTab('references');
      await Promise.all([load(), loadInsights()]);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to promote';
      toast.error(msg);
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

  const filteredInsights = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return insights;
    return insights.filter((i) => i.content.toLowerCase().includes(q));
  }, [insights, search]);

  function openPromote(ref: Reference) {
    setPromoteFrom(ref);
    setPromoteLabel(referenceTitle(ref.content));
    // Memory Blocks are plain text (spec §7.3) — strip HTML from the source
    // Reference before seeding the promote modal so the user edits a clean
    // starting point.
    const plain = ref.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    setPromoteContent(plain.slice(0, REFERENCE_PROMOTE_PREVIEW_MAX));
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

  async function handleArchiveReference() {
    if (!archiveRefId) return;
    try {
      await api.delete(
        `/api/subaccounts/${subaccountId}/knowledge/references/${archiveRefId}`,
      );
      toast.success('Reference archived');
      setArchiveRefId(null);
      await load();
    } catch {
      toast.error('Failed to archive Reference');
    }
  }

  async function handleRenameReference() {
    if (!renameRef) return;
    const title = renameTitle.trim();
    if (!title) return;
    try {
      const nextHtml = renameReferenceHtml(renameRef.content, title);
      await api.patch(
        `/api/subaccounts/${subaccountId}/knowledge/references/${renameRef.id}`,
        { content: nextHtml },
      );
      toast.success('Reference renamed');
      setRenameRef(null);
      setRenameTitle('');
      await load();
    } catch {
      toast.error('Failed to rename Reference');
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
          {tab === 'references' && (
            <button
              onClick={() => openEditReference('new')}
              className="btn btn-primary"
            >
              + New Reference
            </button>
          )}
          {tab === 'blocks' && (
            <button
              onClick={() => openEditBlock('new')}
              className="btn btn-primary"
            >
              + New Memory Block
            </button>
          )}
          {/* Insights are auto-captured — the tab has no create button,
              only promote-to-reference on individual rows. */}
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
        <TabButton active={tab === 'insights'} onClick={() => setTab('insights')}>
          Insights{insights.length ? ` (${insights.length})` : ''}
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
          placeholder={
            tab === 'references'
              ? 'Search references…'
              : tab === 'insights'
                ? 'Search insights…'
                : 'Search memory blocks…'
          }
          className={inputCls}
        />
      </div>

      {/* Insights tab filter row (§7 G6.3) — populated from server-side
          facet aggregation so only values that actually exist are offered. */}
      {tab === 'insights' && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <InsightFilterSelect
            label="Domain"
            value={insightFilters.domain}
            options={insightFacets.domains}
            onChange={(v) => setInsightFilters((f) => ({ ...f, domain: v }))}
          />
          <InsightFilterSelect
            label="Topic"
            value={insightFilters.topic}
            options={insightFacets.topics}
            onChange={(v) => setInsightFilters((f) => ({ ...f, topic: v }))}
          />
          <InsightFilterSelect
            label="Type"
            value={insightFilters.entryType}
            options={insightFacets.entryTypes}
            onChange={(v) => setInsightFilters((f) => ({ ...f, entryType: v }))}
          />
          <InsightFilterSelect
            label="Task"
            value={insightFilters.taskSlug}
            options={insightFacets.taskSlugs}
            onChange={(v) => setInsightFilters((f) => ({ ...f, taskSlug: v }))}
          />
          {(insightFilters.domain ||
            insightFilters.topic ||
            insightFilters.entryType ||
            insightFilters.taskSlug) && (
            <button
              onClick={() =>
                setInsightFilters({ domain: '', topic: '', entryType: '', taskSlug: '' })
              }
              className="px-2.5 py-1 text-[12px] text-indigo-700 hover:text-indigo-900 cursor-pointer"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {tab === 'references' && (
        <ReferencesTable
          items={filteredRefs}
          onPromote={openPromote}
          onEdit={(r) => openEditReference(r)}
          onRename={(r) => {
            setRenameRef(r);
            setRenameTitle(referenceTitle(r.content));
          }}
          onArchive={(id) => setArchiveRefId(id)}
        />
      )}
      {tab === 'insights' && (
        <InsightsTable
          items={filteredInsights}
          loading={insightsLoading}
          onPromote={handlePromoteInsight}
        />
      )}
      {tab === 'blocks' && (
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

      {/* Rename modal — edits the first H1 so the first-line-as-title
          convention stays consistent across the UI. */}
      {renameRef && (
        <Modal
          title="Rename Reference"
          onClose={() => {
            setRenameRef(null);
            setRenameTitle('');
          }}
          maxWidth={480}
        >
          <div className="flex flex-col gap-3.5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Title *</label>
              <input
                value={renameTitle}
                maxLength={120}
                onChange={(e) => setRenameTitle(e.target.value)}
                className={inputCls}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => {
                  setRenameRef(null);
                  setRenameTitle('');
                }}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleRenameReference}
                disabled={!renameTitle.trim()}
                className="btn btn-primary"
              >
                Rename
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

      {archiveRefId && (
        <ConfirmDialog
          title="Archive Reference"
          message="The Reference is hidden from the Knowledge page and excluded from agent memory searches. It can be restored later."
          confirmLabel="Archive"
          onConfirm={handleArchiveReference}
          onCancel={() => setArchiveRefId(null)}
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

function InsightFilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
      <span className="font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1 border border-slate-200 rounded text-[12px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <option value="">All</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Insights tab (spec §7 G6.3 / G6.4) — auto-captured workspace memory entries
 * (agentRunId IS NOT NULL). Each row offers a Promote-to-Reference button
 * that creates a new Reference with a promotedFromEntryId back-link.
 */
function InsightsTable({
  items,
  loading,
  onPromote,
}: {
  items: Insight[];
  loading: boolean;
  onPromote: (insightId: string) => void;
}) {
  if (loading) {
    return (
      <div className="py-12 text-center text-slate-400 text-[14px]">Loading insights…</div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="py-16 text-center text-slate-400">
        <p className="text-[16px] mb-2">No insights yet</p>
        <p className="text-[14px]">
          Insights are captured automatically from agent runs. Run an agent on this workspace to
          seed the list.
        </p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {['Insight', 'Type', 'Domain / Topic', 'Source', 'Quality', 'Captured', 'Actions'].map(
              (h) => (
                <th
                  key={h}
                  className="text-left px-3 py-2.5 text-[12px] font-semibold text-slate-500 uppercase tracking-wide"
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-slate-50 transition-colors align-top">
              <td className="px-3 py-3 text-[13px] text-slate-700 max-w-[480px]">
                <div className="line-clamp-2">{referencePreview(item.content)}</div>
              </td>
              <td className="px-3 py-3 text-[13px] text-slate-500">{item.entryType}</td>
              <td className="px-3 py-3 text-[12px]">
                <div className="flex flex-wrap gap-1">
                  {item.domain && (
                    <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-100">
                      {item.domain}
                    </span>
                  )}
                  {item.topic && (
                    <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded border border-slate-200">
                      {item.topic}
                    </span>
                  )}
                  {!item.domain && !item.topic && (
                    <span className="text-slate-400">&mdash;</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-3 text-[13px] text-slate-500">
                <div className="flex flex-col">
                  <span className="truncate max-w-[160px]" title={item.agentName ?? ''}>
                    {item.agentName ?? '—'}
                  </span>
                  {item.taskSlug && (
                    <span className="text-[11px] text-slate-400">{item.taskSlug}</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-3 text-[13px] text-slate-500">
                {typeof item.qualityScore === 'number'
                  ? item.qualityScore.toFixed(2)
                  : '—'}
              </td>
              <td className="px-3 py-3 text-[13px] text-slate-500">
                {new Date(item.createdAt).toLocaleDateString()}
              </td>
              <td className="px-3 py-3">
                <button
                  onClick={() => onPromote(item.id)}
                  className="btn btn-xs btn-ghost text-indigo-700 hover:bg-indigo-50"
                >
                  Promote
                </button>
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
