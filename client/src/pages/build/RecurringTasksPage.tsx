import React, { useState, useEffect } from 'react';
import { buildApi } from '../../lib/api/build';
import { PageShell } from '../../components/PageShell';
import { SortableTable, type ColumnDef } from '../../components/SortableTable';
import { SearchBox } from '../../components/SearchBox';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { WorkspaceBadge } from '../../components/WorkspaceBadge';
import { useViewMode } from '../../hooks/useViewMode';
import type { RecurringTask, RecurringTasksResponse } from '../../../../shared/types/build';

export default function RecurringTasksPage() {
  const { viewMode } = useViewMode();
  const [q, setQ] = useState('');
  const [data, setData] = useState<RecurringTasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    buildApi.listRecurringTasks({ scope: viewMode, q: q || undefined })
      .then(r => { setData(r); setLoading(false); })
      .catch(e => { setError(e); setLoading(false); });
  }, [viewMode, q, retryKey]);

  const columns: ColumnDef<RecurringTask>[] = [
    { key: 'name', label: 'Name', sortable: true, getValue: (r) => r.name },
    { key: 'fireCondition', label: 'Fire condition', sortable: true, getValue: (r) => r.fireCondition },
    { key: 'action', label: 'Action', sortable: true, getValue: (r) => r.action },
    {
      key: 'scope',
      label: 'Scope',
      render: (r) => <WorkspaceBadge clientId={r.scope.id} clientName={r.scope.name} />,
    },
    {
      key: 'project',
      label: 'Project',
      render: (r) => r.project ? <span>{r.project.name}</span> : <span className="text-slate-400">None</span>,
    },
    { key: 'status', label: 'Status', sortable: true, filterable: true, getValue: (r) => r.status },
    {
      key: 'lastFiredAt',
      label: 'Last fired',
      sortable: true,
      getValue: (r) => r.lastFiredAt,
      render: (r) => r.lastFiredAt ? new Date(r.lastFiredAt).toLocaleDateString() : <span className="text-slate-400">Never</span>,
    },
    { key: 'fires30d', label: 'Fires (30d)', sortable: true, align: 'right', getValue: (r) => r.fires30d },
    {
      key: 'nextFireAt',
      label: 'Next fire',
      sortable: true,
      getValue: (r) => r.nextFireAt,
      render: (r) => r.nextFireAt ? new Date(r.nextFireAt).toLocaleDateString() : <span className="text-slate-400">None</span>,
    },
  ];

  if (loading) return <PageShell><div className="p-8 text-slate-400">Loading recurring tasks...</div></PageShell>;
  if (error) return <PageShell><ErrorState error={error} retry={() => setRetryKey(k => k + 1)} /></PageShell>;

  const rows = data?.rows ?? [];

  if (rows.length === 0) return (
    <PageShell>
      <div className="px-6 py-4">
        <SearchBox value={q} onChange={setQ} placeholder="Search recurring tasks..." />
      </div>
      <EmptyState title="No recurring tasks" body="Recurring tasks appear here when agents have triggers or schedules." />
    </PageShell>
  );

  return (
    <PageShell header={
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <h1 className="text-lg font-semibold text-slate-800">Recurring tasks</h1>
      </div>
    }>
      <div className="px-6 py-4">
        <SearchBox value={q} onChange={setQ} placeholder="Search recurring tasks..." />
        <div className="mt-4">
          <SortableTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            persistKey="recurring-tasks"
          />
        </div>
      </div>
    </PageShell>
  );
}
