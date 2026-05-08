// client/src/pages/govern/KnowledgePage.tsx
// Govern surface — Knowledge page.
// Spec: tasks/builds/consolidation-govern/spec.md §4.1, §4.7, §4.8, §4.12, §4.13, §4.14
//       tasks/builds/auto-knowledge-retrieval/plan.md Chunk 5D

import { useEffect, useMemo, useState } from 'react';
import { PageShell } from '../../components/PageShell';
import { SearchBox } from '../../components/SearchBox';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { SortableTable, type ColumnDef } from '../../components/SortableTable';
import ViewModeSwitcher from '../../components/ViewModeSwitcher';
import ConfirmDialog from '../../components/ConfirmDialog';
import { HelpHint } from '../../components/ui/HelpHint';
import { WorkspaceBadge } from '../../components/WorkspaceBadge';
import { useViewMode } from '../../hooks/useViewMode';
import { listKnowledge, rejectKnowledge } from '../../api/governApi';
import { getUserRole, getActiveClientId } from '../../lib/auth';
import type { KnowledgeEntry } from '../../../../shared/types/govern.js';
import { KnowledgeRow } from './components/KnowledgeRow';
import { KnowledgeOverrideDialog } from './components/KnowledgeOverrideDialog';
import { KnowledgeFilesTab } from './components/KnowledgeFilesTab';
import { KnowledgeDocumentsTab } from './components/KnowledgeDocumentsTab';

type Tab = 'authored-memory' | 'auto-memory' | 'documents' | 'files' | 'bundles';

const TABS: { id: Tab; label: string }[] = [
  { id: 'authored-memory', label: 'Authored memory' },
  { id: 'auto-memory', label: 'Auto-memory' },
  { id: 'documents', label: 'Documents' },
  { id: 'files', label: 'Files' },
  { id: 'bundles', label: 'Bundles' },
];

function canWriteKnowledge(): boolean {
  const role = getUserRole();
  return role === 'org_admin' || role === 'system_admin';
}

export default function KnowledgePage() {
  const [activeTab, setActiveTab] = useState<Tab>('auto-memory');
  const { viewMode, availableModes, setViewMode } = useViewMode();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<KnowledgeEntry[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<KnowledgeEntry | null>(null);
  const [rejectTarget, setRejectTarget] = useState<KnowledgeEntry | null>(null);
  const [rejectBusy, setRejectBusy] = useState(false);
  // Increment to force a re-fetch without changing q
  const [fetchKey, setFetchKey] = useState(0);

  const hasWritePerm = canWriteKnowledge();

  useEffect(() => {
    if (activeTab !== 'auto-memory') return;
    setRows(null);
    setError(null);
    const isWorkspace = viewMode !== 'org';
    const subaccountId = isWorkspace ? getActiveClientId() ?? undefined : undefined;
    // In workspace view, if no active workspace is selected, the request would
    // silently return all org rows on the server — fail-closed locally instead.
    if (isWorkspace && !subaccountId) {
      setError(new Error('No active workspace selected.'));
      return;
    }
    listKnowledge({ scope: isWorkspace ? 'workspace' : 'org', subaccountId, q })
      .then((r) => setRows(r.rows))
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [activeTab, viewMode, q, fetchKey]);

  const columns: ColumnDef<KnowledgeEntry>[] = useMemo(() => {
    const baseColumns: ColumnDef<KnowledgeEntry>[] = [
      {
        key: 'body',
        label: 'Entry',
        sortable: false,
        filterable: false,
        render: (r) => (
          <KnowledgeRow
            row={r}
            hasWritePerm={hasWritePerm}
            onOverride={setOverrideTarget}
            onReject={setRejectTarget}
            onApproveSuccess={() => setFetchKey((k) => k + 1)}
          />
        ),
      },
      {
        key: 'status',
        label: 'Status',
        sortable: true,
        filterable: true,
        getValue: (r) => r.status,
      },
      {
        key: 'kind',
        label: 'Kind',
        sortable: true,
        filterable: true,
        getValue: (r) => r.kind,
      },
      {
        key: 'confidence',
        label: 'Confidence',
        sortable: true,
        filterable: false,
        align: 'right',
        getValue: (r) => r.confidence,
        render: (r) => (
          <span className="inline-flex items-center gap-1 justify-end">
            {r.confidence.toFixed(2)}
            {/* HelpHint rendered inline because ColumnDef.label is strictly string */}
            <HelpHint text="0-1 confidence score from the extracting agent. Below 0.5: weak signal. 0.5-0.8: moderate. Above 0.8: strong." />
          </span>
        ),
      },
    ];

    if (viewMode === 'org') {
      baseColumns.push({
        key: 'subaccount',
        label: 'Workspace',
        sortable: false,
        filterable: false,
        render: (r) =>
          r.subaccount ? (
            <WorkspaceBadge clientId={r.subaccount.id} clientName={r.subaccount.name} />
          ) : (
            <span className="text-slate-400 text-xs">Org-level</span>
          ),
      });
    }

    return baseColumns;
  }, [viewMode, hasWritePerm]);

  const tabStrip = (
    <div className="flex border-b border-slate-200">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => setActiveTab(tab.id)}
          className={
            activeTab === tab.id
              ? 'border-b-2 border-indigo-600 text-indigo-600 font-semibold px-4 py-2.5 text-sm'
              : 'border-b-2 border-transparent text-slate-500 hover:text-slate-700 px-4 py-2.5 text-sm'
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  if (activeTab === 'auto-memory' && error) {
    return (
      <PageShell
        header={
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h1 className="text-lg font-semibold text-slate-900">Knowledge</h1>
          </div>
        }
      >
        {tabStrip}
        <ErrorState error={error} retry={() => setFetchKey((k) => k + 1)} />
      </PageShell>
    );
  }

  return (
    <PageShell
      header={
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h1 className="text-lg font-semibold text-slate-900">Knowledge</h1>
        </div>
      }
    >
      {tabStrip}

      {activeTab === 'authored-memory' && (
        <div className="p-6 text-sm text-slate-500">Authored memory tab — coming soon.</div>
      )}

      {activeTab === 'auto-memory' && (
        <>
          <div className="flex items-center justify-end gap-3 px-6 py-3 border-b border-slate-100">
            <ViewModeSwitcher
              value={viewMode}
              onChange={setViewMode}
              availableModes={availableModes}
            />
            <SearchBox
              value={q}
              onChange={setQ}
              placeholder="Search entries, agent, run ID..."
            />
          </div>
          {rows === null ? (
            <div className="text-sm text-slate-500 py-8 px-6">Loading...</div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No entries match your filters"
              body={q ? 'Try a different search term or clear the search.' : 'No knowledge entries found.'}
              primaryAction={q ? { label: 'Clear search', onClick: () => setQ('') } : undefined}
            />
          ) : (
            <SortableTable
              rows={rows}
              columns={columns}
              rowKey={(r) => r.id}
              persistKey={`knowledge-${viewMode}`}
              initialSort={{ key: 'status', dir: 'asc' }}
            />
          )}

          {overrideTarget && (
            <KnowledgeOverrideDialog
              entry={overrideTarget}
              onClose={() => setOverrideTarget(null)}
              onSaved={() => {
                setOverrideTarget(null);
                setFetchKey((k) => k + 1);
              }}
            />
          )}

          {rejectTarget && (
            <ConfirmDialog
              title="Reject knowledge entry?"
              message="Reject this knowledge entry? It will be moved to ignored."
              confirmLabel="Reject"
              onCancel={() => setRejectTarget(null)}
              onConfirm={async () => {
                if (rejectBusy) return;
                setRejectBusy(true);
                try {
                  await rejectKnowledge(rejectTarget.id);
                  setRejectTarget(null);
                  setFetchKey((k) => k + 1);
                } finally {
                  setRejectBusy(false);
                }
              }}
            />
          )}
        </>
      )}

      {activeTab === 'documents' && <KnowledgeDocumentsTab />}

      {activeTab === 'files' && <KnowledgeFilesTab />}

      {activeTab === 'bundles' && (
        <div className="p-6 text-sm text-slate-500">Bundles — coming soon.</div>
      )}
    </PageShell>
  );
}
