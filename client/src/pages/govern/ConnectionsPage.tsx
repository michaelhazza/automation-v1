// client/src/pages/govern/ConnectionsPage.tsx
// Govern surface — Connections page.
// Spec: tasks/builds/consolidation-govern/spec.md §4.6, §4.7, §4.8, §4.9, §4.10, §4.13, §4.14

import { useEffect, useMemo, useState } from 'react';
import { PageShell } from '../../components/PageShell';
import { SearchBox } from '../../components/SearchBox';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { SortableTable, type ColumnDef } from '../../components/SortableTable';
import ViewModeSwitcher from '../../components/ViewModeSwitcher';
import { WorkspaceBadge } from '../../components/WorkspaceBadge';
import { useViewMode } from '../../hooks/useViewMode';
import { listConnections } from '../../api/governApi';
import { getUserRole, getActiveClientId } from '../../lib/auth';
import type { Connection } from '../../../../shared/types/govern.js';
import { ConnectionTestButton } from './components/ConnectionTestButton';
import { DisconnectConfirmDialog } from './components/DisconnectConfirmDialog';

const STATUS_PILL: Record<Connection['status'], { label: string; className: string }> = {
  connected: { label: 'Connected', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  expired:   { label: 'Expired',   className: 'bg-amber-50 text-amber-700 border-amber-200' },
  failed:    { label: 'Failed',    className: 'bg-red-50 text-red-700 border-red-200' },
  pending:   { label: 'Pending',   className: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const AUTH_LABEL: Record<Connection['authMethod'], string> = {
  oauth:           'OAuth',
  api_key:         'API Key',
  web_login:       'Web Login',
  mcp:             'MCP',
  cookie:          'Cookie',
  ai_subscription: 'AI Subscription',
};

function isOrgAdmin(): boolean {
  const role = getUserRole();
  return role === 'org_admin' || role === 'system_admin';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ConnectionsPage() {
  const { viewMode, availableModes, setViewMode } = useViewMode();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Connection[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);
  const [disconnectTarget, setDisconnectTarget] = useState<Connection | null>(null);

  const orgAdmin = isOrgAdmin();

  useEffect(() => {
    setRows(null);
    setError(null);
    const isWorkspace = viewMode !== 'org';
    const subaccountId = isWorkspace ? getActiveClientId() ?? undefined : undefined;
    if (isWorkspace && !subaccountId) {
      setError(new Error('No active workspace selected.'));
      return;
    }
    listConnections({ scope: isWorkspace ? 'workspace' : 'org', subaccountId, q })
      .then((r) => setRows(r.rows))
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [viewMode, q, fetchKey]);

  const columns: ColumnDef<Connection>[] = useMemo(() => {
    const cols: ColumnDef<Connection>[] = [
      {
        key: 'name',
        label: 'Name',
        sortable: true,
        filterable: false,
        getValue: (r) => r.name,
        render: (r) => (
          <span className="font-medium text-slate-900 text-sm">{r.name}</span>
        ),
      },
      {
        key: 'provider',
        label: 'Provider',
        sortable: true,
        filterable: true,
        getValue: (r) => r.provider,
        render: (r) => <span className="text-sm text-slate-700">{r.provider}</span>,
      },
      {
        key: 'authMethod',
        label: 'Auth method',
        sortable: true,
        filterable: true,
        getValue: (r) => r.authMethod,
        render: (r) => <span className="text-sm text-slate-600">{AUTH_LABEL[r.authMethod]}</span>,
      },
      {
        key: 'status',
        label: 'Status',
        sortable: true,
        filterable: true,
        getValue: (r) => r.status,
        render: (r) => {
          const pill = STATUS_PILL[r.status];
          return (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${pill.className}`}>
              {pill.label}
            </span>
          );
        },
      },
      {
        key: 'lastSyncAt',
        label: 'Last sync',
        sortable: true,
        filterable: false,
        getValue: (r) => r.lastSyncAt ?? '',
        render: (r) => <span className="text-sm text-slate-500">{formatDate(r.lastSyncAt)}</span>,
      },
      {
        key: 'owner',
        label: 'Owner',
        sortable: false,
        filterable: false,
        render: (r) =>
          r.owner.kind === 'workspace' ? (
            <WorkspaceBadge clientId={r.owner.id} clientName={r.owner.name} />
          ) : (
            <span className="text-xs text-slate-500 font-medium">Org</span>
          ),
      },
      {
        key: 'actions',
        label: 'Actions',
        sortable: false,
        filterable: false,
        render: (r) => {
          // Spec §4.14: hide connect/disconnect/refresh for non-org-admin on org-owned connections
          const hideActions = r.owner.kind === 'org' && !orgAdmin;
          return (
            <div className="flex items-center gap-2">
              <ConnectionTestButton connectionId={r.id} />
              {!hideActions && (
                <button
                  type="button"
                  onClick={() => setDisconnectTarget(r)}
                  className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded border border-slate-200 bg-white text-red-600 hover:bg-red-50 hover:border-red-200 transition-colors"
                >
                  Disconnect
                </button>
              )}
            </div>
          );
        },
      },
    ];

    return cols;
  }, [orgAdmin]);

  if (error) {
    return (
      <PageShell
        header={
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h1 className="text-lg font-semibold text-slate-900">Connections</h1>
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
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h1 className="text-lg font-semibold text-slate-900">Connections</h1>
          <div className="flex items-center gap-3">
            <ViewModeSwitcher
              value={viewMode}
              onChange={setViewMode}
              availableModes={availableModes}
            />
            <SearchBox
              value={q}
              onChange={setQ}
              placeholder="Search name, provider..."
            />
          </div>
        </div>
      }
    >
      {rows === null ? (
        <div className="text-sm text-slate-500 py-8 px-6">Loading...</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No connections match your filters"
          body={q ? 'Try a different search term or clear the search.' : 'No connections found.'}
          primaryAction={q ? { label: 'Clear search', onClick: () => setQ('') } : undefined}
        />
      ) : (
        <SortableTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          persistKey={`connections-${viewMode}`}
          initialSort={{ key: 'name', dir: 'asc' }}
        />
      )}

      {disconnectTarget && (
        <DisconnectConfirmDialog
          connectionId={disconnectTarget.id}
          onClose={() => setDisconnectTarget(null)}
          onDisconnected={() => {
            setDisconnectTarget(null);
            setFetchKey((k) => k + 1);
          }}
        />
      )}
    </PageShell>
  );
}
