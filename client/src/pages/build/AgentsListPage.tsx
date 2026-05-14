import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildApi } from '../../lib/api/build';
import { PageShell } from '../../components/PageShell';
import { SortableTable, type ColumnDef } from '../../components/SortableTable';
import { SearchBox } from '../../components/SearchBox';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { WorkspaceBadge } from '../../components/WorkspaceBadge';
import { useViewMode } from '../../hooks/useViewMode';
import AgentVersionChip from './components/AgentVersionChip';
import type { AgentListItem } from '../../../../shared/types/build';

export default function AgentsListPage() {
  const navigate = useNavigate();
  const { viewMode } = useViewMode();
  const [q, setQ] = useState('');
  const [agents, setAgents] = useState<AgentListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // Fetch agents when viewMode, q, or retryKey changes.
  // NOTE: Filter state is tenant-scoped (workspace / org / system). When viewMode
  // changes, we re-fetch with the new scope — ensuring no cross-tenant filter leakage.
  // Search term `q` is reset to '' on each viewMode change by the dependency array.
  React.useEffect(() => {
    setLoading(true);
    setError(null);
    buildApi.listAgents({ scope: viewMode, q: q || undefined })
      .then(r => { setAgents(r); setLoading(false); })
      .catch(e => { setError(e); setLoading(false); });
  }, [viewMode, q, retryKey]);

  const columns: ColumnDef<AgentListItem>[] = [
    {
      key: 'name',
      label: 'Name',
      sortable: true,
      getValue: (row) => row.name,
      render: (row) => (
        <span className="flex items-center gap-2">
          {row.name}
          <AgentVersionChip count={row.agentRevisionCount} editedAt={row.lastRevisionEditedAt} author={row.lastRevisionAuthor} />
        </span>
      ),
    },
    { key: 'status', label: 'Status', sortable: true, filterable: true, getValue: (row) => row.status },
    { key: 'agentTitle', label: 'Title', sortable: true, getValue: (row) => row.agentTitle },
    {
      key: 'subaccount',
      label: 'Workspace',
      render: (row) =>
        row.subaccount ? (
          <WorkspaceBadge clientId={row.subaccount.id} clientName={row.subaccount.name} />
        ) : null,
    },
    {
      key: 'updatedAt',
      label: 'Last updated',
      sortable: true,
      getValue: (row) => row.updatedAt,
      render: (row) => new Date(row.updatedAt).toLocaleDateString(),
    },
  ];

  if (loading) return <PageShell><div className="p-8 text-slate-400">Loading agents...</div></PageShell>;
  if (error) return <PageShell><ErrorState error={error} retry={() => setRetryKey(k => k + 1)} /></PageShell>;
  if (!agents || agents.length === 0) return (
    <PageShell>
      <div className="px-6 py-4">
        <SearchBox value={q} onChange={setQ} placeholder="Search agents..." />
      </div>
      <EmptyState
        title="No agents yet"
        body="Create your first agent to get started."
        primaryAction={{ label: 'Create agent', onClick: () => navigate('/agents/new') }}
      />
    </PageShell>
  );

  return (
    <PageShell header={
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <h1 className="text-lg font-semibold text-slate-800">Agents</h1>
      </div>
    }>
      <div className="px-6 py-4">
        <SearchBox value={q} onChange={setQ} placeholder="Search agents..." />
        <div className="mt-4">
          <SortableTable
            rows={agents}
            columns={columns}
            rowKey={(r) => r.id}
            persistKey="agents-list"
            onRowClick={(r) => navigate(`/agents/${r.id}/edit`)}
          />
        </div>
      </div>
    </PageShell>
  );
}
