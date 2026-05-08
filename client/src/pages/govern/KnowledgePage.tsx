// client/src/pages/govern/KnowledgePage.tsx
// Govern surface — Knowledge page.
// Spec: tasks/builds/consolidation-govern/spec.md §4.1, §4.7, §4.8, §4.12, §4.13, §4.14
// Trust & Verification Layer spec §13.4, §13.5 — filter chips + Source column + provenance drawer.

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
import { SourcePillKnowledge } from '../../components/knowledge/SourcePillKnowledge';
import { useViewMode } from '../../hooks/useViewMode';
import { listKnowledge, rejectKnowledge } from '../../api/governApi';
import { getUserRole, getActiveClientId } from '../../lib/auth';
import type { KnowledgeEntry, KnowledgeSourceFilter } from '../../../../shared/types/govern.js';
import { KnowledgeRow } from './components/KnowledgeRow';
import { KnowledgeOverrideDialog } from './components/KnowledgeOverrideDialog';

function canWriteKnowledge(): boolean {
  const role = getUserRole();
  return role === 'org_admin' || role === 'system_admin';
}

type FilterChip = { value: KnowledgeSourceFilter; label: string };

const FILTER_CHIPS: FilterChip[] = [
  { value: 'all',         label: 'All' },
  { value: 'corrections', label: 'From corrections' },
  { value: 'manual',      label: 'Manually authored' },
  { value: 'auto',        label: 'Auto-synthesised' },
];

const EMPTY_BODY: Record<KnowledgeSourceFilter, string> = {
  all:         'No knowledge entries found.',
  corrections: 'No corrections in the last 30 days. Corrections appear when an operator edits an agent output.',
  manual:      'No manually authored entries yet.',
  auto:        'No auto-synthesised entries yet.',
};

export default function KnowledgePage() {
  const { viewMode, availableModes, setViewMode } = useViewMode();
  const [q, setQ] = useState('');
  const [source, setSource] = useState<KnowledgeSourceFilter>('all');
  const [rows, setRows] = useState<KnowledgeEntry[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<KnowledgeEntry | null>(null);
  const [rejectTarget, setRejectTarget] = useState<KnowledgeEntry | null>(null);
  const [rejectBusy, setRejectBusy] = useState(false);
  // Increment to force a re-fetch without changing q or source
  const [fetchKey, setFetchKey] = useState(0);

  const hasWritePerm = canWriteKnowledge();

  useEffect(() => {
    setRows(null);
    setError(null);
    const isWorkspace = viewMode !== 'org';
    const subaccountId = isWorkspace ? getActiveClientId() ?? undefined : undefined;
    if (isWorkspace && !subaccountId) {
      setError(new Error('No active workspace selected.'));
      return;
    }
    listKnowledge({ scope: isWorkspace ? 'workspace' : 'org', subaccountId, q, source: source === 'all' ? undefined : source })
      .then((r) => setRows(r.rows))
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [viewMode, q, source, fetchKey]);

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
        key: 'source' as keyof KnowledgeEntry,
        label: 'Source',
        sortable: false,
        filterable: false,
        render: (r) => (
          <SourcePillKnowledge
            capturedVia={r.capturedVia}
            onClick={r.capturedVia !== (source === 'all' ? '' : source)
              ? () => {
                  if (r.capturedVia === 'operator_correction') setSource('corrections');
                  else if (r.capturedVia === 'manual_edit') setSource('manual');
                  else if (r.capturedVia === 'auto_synthesised') setSource('auto');
                }
              : undefined
            }
          />
        ),
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
  }, [viewMode, hasWritePerm, source]);

  if (error) {
    return (
      <PageShell
        header={
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h1 className="text-lg font-semibold text-slate-900">Knowledge</h1>
          </div>
        }
      >
        <ErrorState error={error} retry={() => setFetchKey((k) => k + 1)} />
      </PageShell>
    );
  }

  return (
    <PageShell
      header={
        <div className="flex flex-col gap-3 px-6 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-slate-900">Knowledge</h1>
            <div className="flex items-center gap-3">
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
          </div>
          {/* Source filter chips — spec §13.4 */}
          <div className="flex items-center gap-2">
            {FILTER_CHIPS.map((chip) => (
              <button
                key={chip.value}
                type="button"
                onClick={() => setSource(chip.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  source === chip.value
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {rows === null ? (
        <div className="text-sm text-slate-500 py-8 px-6">Loading...</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No entries match your filters"
          body={q ? 'Try a different search term or clear the search.' : EMPTY_BODY[source]}
          primaryAction={
            q ? { label: 'Clear search', onClick: () => setQ('') }
            : source !== 'all' ? { label: 'Show all entries', onClick: () => setSource('all') }
            : undefined
          }
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
    </PageShell>
  );
}
