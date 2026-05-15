import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import EditArtefactDrawer from '../components/baseline/EditArtefactDrawer';
import BaselineArtefactsStatusBadge from '../components/baseline/BaselineArtefactsStatusBadge';
import { BASELINE_SLUGS, TIER_BY_SLUG } from '../../../shared/constants/baselineArtefacts';
import type { ArtefactStatus } from '../../../shared/constants/baselineArtefacts';
import TabButton from '../components/subaccount-knowledge/TabButton';
import { inputCls } from '../components/subaccount-knowledge/types';
import type { Reference, MemoryBlock } from '../components/subaccount-knowledge/types';
import { BlocksTab } from '../components/subaccount-knowledge/BlocksTab';
import { InsightsTab } from '../components/subaccount-knowledge/InsightsTab';
import { ReferencesTab } from '../components/subaccount-knowledge/ReferencesTab';

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

type Tab = 'references' | 'insights' | 'blocks';

export default function SubaccountKnowledgePage({ user: _user }: { user: { id: string; role: string } }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [tab, setTab] = useState<Tab>('references');
  const [references, setReferences] = useState<Reference[]>([]);
  const [blocks, setBlocks] = useState<MemoryBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Pending create signal — set by "+ New" header buttons; consumed by active tab
  const [pendingCreate, setPendingCreate] = useState<'reference' | 'block' | null>(null);

  // Baseline artefacts section state
  const [artefactStatuses, setArtefactStatuses] = useState<Record<string, ArtefactStatus>>({});
  const [drawerSlug, setDrawerSlug] = useState<string | null>(null);

  useEffect(() => {
    if (!subaccountId) return;
    load();
    loadArtefactStatus();
    // reason: `load` and `loadArtefactStatus` are inline async functions that close over state setters; only subaccountId is the intended trigger.
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

  async function loadArtefactStatus() {
    try {
      const res = await api.get(`/api/subaccounts/${subaccountId}/baseline-artefacts-status`);
      const raw = res.data.status;
      if (!raw) return;
      const statuses: Record<string, ArtefactStatus> = {};
      for (const slug of BASELINE_SLUGS) {
        const shortKey = slug.split('.')[1];
        const tier = TIER_BY_SLUG[slug];
        const tierKey = `tier${tier}` as 'tier1' | 'tier2' | 'tier3';
        const entry = (raw[tierKey] as Record<string, { status: string }> | undefined)?.[shortKey];
        if (entry?.status) {
          statuses[slug] = entry.status as ArtefactStatus;
        }
      }
      setArtefactStatuses(statuses);
    } catch {
      // Non-critical — silently ignore if status cannot be loaded
    }
  }

  const clearPendingCreate = useCallback(() => setPendingCreate(null), []);

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
              onClick={() => setPendingCreate('reference')}
              className="btn btn-primary"
            >
              + New Reference
            </button>
          )}
          {tab === 'blocks' && (
            <button
              onClick={() => setPendingCreate('block')}
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

      {/* Baseline artefacts section */}
      <div className="mb-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <h2 className="text-[13px] font-semibold text-slate-700 m-0">Baseline artefacts</h2>
        </div>
        <ul className="divide-y divide-slate-50">
          {BASELINE_SLUGS.map((slug) => {
            const shortKey = slug.split('.')[1];
            const name = shortKey
              .replace(/_/g, ' ')
              .replace(/^./, (c) => c.toUpperCase());
            const tier = TIER_BY_SLUG[slug];
            const status = artefactStatuses[slug] ?? 'not_started';
            return (
              <li key={slug} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-[13px] text-slate-800 font-medium">{name}</span>
                  <span className="text-[11px] text-slate-400">Tier {tier}</span>
                </div>
                <div className="flex items-center gap-3">
                  <BaselineArtefactsStatusBadge status={status} slug={slug} />
                  {status === 'completed' && (
                    <button
                      onClick={() => setDrawerSlug(slug)}
                      className="btn btn-xs btn-secondary"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 mb-4">
        <TabButton active={tab === 'references'} onClick={() => setTab('references')}>
          References ({references.length})
        </TabButton>
        <TabButton active={tab === 'insights'} onClick={() => setTab('insights')}>
          Insights
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

      {tab === 'references' && subaccountId && (
        <ReferencesTab
          subaccountId={subaccountId}
          items={references}
          search={search}
          openCreateOnMount={pendingCreate === 'reference'}
          onCreateConsumed={clearPendingCreate}
          onMutated={load}
          onTabSwitchTo={setTab}
        />
      )}
      {tab === 'insights' && subaccountId && (
        <InsightsTab
          subaccountId={subaccountId}
          search={search}
          onTabSwitchTo={setTab}
          onPromotedToReference={load}
        />
      )}
      {tab === 'blocks' && subaccountId && (
        <BlocksTab
          subaccountId={subaccountId}
          items={blocks}
          search={search}
          openCreateOnMount={pendingCreate === 'block'}
          onCreateConsumed={clearPendingCreate}
          onMutated={load}
          onTabSwitchTo={setTab}
        />
      )}

      {drawerSlug && subaccountId && (
        <EditArtefactDrawer
          artefactSlug={drawerSlug}
          subaccountId={subaccountId}
          open={drawerSlug !== null}
          onClose={() => setDrawerSlug(null)}
          onSaved={() => loadArtefactStatus()}
        />
      )}
    </div>
  );
}
