// client/src/pages/govern/SpendingPage.tsx
// Govern surface — Spending page (Ledger tab + Caps & Budgets tab).
// Spec: tasks/builds/consolidation-govern/spec.md §4.2, §4.4, §4.7, §4.8, §4.14

import { useEffect, useMemo, useState } from 'react';
import { PageShell } from '../../components/PageShell';
import { SearchBox } from '../../components/SearchBox';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { SortableTable, type ColumnDef } from '../../components/SortableTable';
import ViewModeSwitcher from '../../components/ViewModeSwitcher';
import { WorkspaceBadge } from '../../components/WorkspaceBadge';
import { useViewMode } from '../../hooks/useViewMode';
import { listLedger, getSpendInsights } from '../../api/governApi';
import { getUserRole } from '../../lib/auth';
import type { LedgerRow, SpendInsights } from '../../../../shared/types/govern.js';
import { SpendInsightsRow } from './components/SpendInsightsRow';

type ViewMode = 'workspace' | 'org' | 'system';

const costFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function isOrgAdmin(): boolean {
  const role = getUserRole();
  return role === 'org_admin' || role === 'system_admin';
}

// ── Ledger tab ────────────────────────────────────────────────────────────────

interface LedgerTabProps {
  viewMode: ViewMode;
}

function LedgerTab({ viewMode }: LedgerTabProps) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);
  const [insights, setInsights] = useState<SpendInsights | null>(null);

  const showInsights = viewMode === 'org' && isOrgAdmin();

  useEffect(() => {
    setRows(null);
    setError(null);
    listLedger({ scope: viewMode === 'org' ? 'org' : 'workspace', q })
      .then((r) => setRows(r.rows))
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [viewMode, q, fetchKey]);

  useEffect(() => {
    if (!showInsights) {
      setInsights(null);
      return;
    }
    getSpendInsights()
      .then(setInsights)
      .catch(() => {
        // Non-fatal: insights failing does not block the ledger
        setInsights(null);
      });
  }, [showInsights]);

  const columns: ColumnDef<LedgerRow>[] = useMemo(() => {
    const base: ColumnDef<LedgerRow>[] = [
      {
        key: 'timestamp',
        label: 'Timestamp',
        sortable: true,
        filterable: false,
        getValue: (r) => r.timestamp,
        render: (r) => (
          <span className="tabular-nums text-slate-700">
            {new Date(r.timestamp).toLocaleString()}
          </span>
        ),
      },
    ];

    if (viewMode === 'org') {
      base.push({
        key: 'workspace',
        label: 'Workspace',
        sortable: true,
        filterable: true,
        getValue: (r) => r.workspace.name,
        render: (r) => (
          <WorkspaceBadge clientId={r.workspace.id} clientName={r.workspace.name} />
        ),
      });
    }

    base.push(
      {
        key: 'agent',
        label: 'Agent',
        sortable: true,
        filterable: true,
        getValue: (r) => r.agent.name,
      },
      {
        key: 'type',
        label: 'Type',
        sortable: true,
        filterable: true,
        getValue: (r) => r.type,
      },
      {
        key: 'provider',
        label: 'Provider',
        sortable: true,
        filterable: true,
        getValue: (r) => r.provider,
      },
      {
        key: 'model',
        label: 'Model',
        sortable: false,
        filterable: false,
        getValue: (r) => r.model ?? '',
        render: (r) => <span className="text-slate-500 text-xs">{r.model ?? '—'}</span>,
      },
      {
        key: 'tokensIn',
        label: 'Tokens in',
        sortable: false,
        filterable: false,
        getValue: (r) => r.tokensIn ?? 0,
        render: (r) => <span className="tabular-nums text-right text-xs">{r.tokensIn?.toLocaleString() ?? '—'}</span>,
      },
      {
        key: 'tokensOut',
        label: 'Tokens out',
        sortable: false,
        filterable: false,
        getValue: (r) => r.tokensOut ?? 0,
        render: (r) => <span className="tabular-nums text-right text-xs">{r.tokensOut?.toLocaleString() ?? '—'}</span>,
      },
      {
        key: 'costUsd',
        label: 'Cost (USD)',
        sortable: true,
        filterable: false,
        align: 'right',
        getValue: (r) => r.costUsd,
        render: (r) => (
          <span className="tabular-nums">{costFmt.format(r.costUsd)}</span>
        ),
      },
    );

    return base;
  }, [viewMode]);

  if (error) {
    return <ErrorState error={error} retry={() => setFetchKey((k) => k + 1)} />;
  }

  return (
    <div className="px-6 py-4">
      <div className="flex items-center justify-end mb-4">
        <SearchBox
          value={q}
          onChange={setQ}
          placeholder="Search ledger..."
        />
      </div>

      {showInsights && insights && (
        <SpendInsightsRow insights={insights} />
      )}

      {rows === null ? (
        <div className="text-sm text-slate-500 py-8">Loading...</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No ledger entries"
          body={q ? 'Try a different search term or clear the search.' : 'No spend records found.'}
          primaryAction={q ? { label: 'Clear search', onClick: () => setQ('') } : undefined}
        />
      ) : (
        <SortableTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          persistKey={`spending-ledger-${viewMode}`}
          initialSort={{ key: 'timestamp', dir: 'desc' }}
        />
      )}
    </div>
  );
}

// ── Caps tab (placeholder — C10 will replace) ─────────────────────────────────

function CapsTab() {
  return (
    <div className="px-6 py-4 text-sm text-slate-500">
      Caps &amp; Budgets — implemented in C10
    </div>
  );
}

// ── SpendingPage ──────────────────────────────────────────────────────────────

export default function SpendingPage() {
  const [activeTab, setActiveTab] = useState<'ledger' | 'caps'>('ledger');
  const { viewMode, availableModes, setViewMode } = useViewMode();

  return (
    <PageShell
      header={
        <div className="flex flex-col border-b border-slate-100">
          <div className="flex items-center justify-between px-6 py-4">
            <h1 className="text-lg font-semibold text-slate-900">Spending</h1>
            <ViewModeSwitcher
              value={viewMode}
              onChange={setViewMode}
              availableModes={availableModes}
            />
          </div>
          <div className="flex items-center gap-0 px-6">
            <button
              type="button"
              className={[
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'ledger'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              ].join(' ')}
              onClick={() => setActiveTab('ledger')}
            >
              Ledger
            </button>
            <button
              type="button"
              className={[
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'caps'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              ].join(' ')}
              onClick={() => setActiveTab('caps')}
            >
              Caps &amp; Budgets
            </button>
          </div>
        </div>
      }
    >
      {activeTab === 'ledger' ? (
        <LedgerTab viewMode={viewMode} />
      ) : (
        <CapsTab />
      )}
    </PageShell>
  );
}
