// client/src/pages/operate/ActivityPage.tsx
//
// Operate > Activity page.
// - <SearchBox> with 200ms debounce wired to `q`
// - <SortableTable persistKey="operate-activity"> for the activity feed
// - <Drawer> opens on row click (activity detail)
// - <EmptyState> with "Clear filters" CTA when the filtered list is empty
// - Stale-response guard: monotonic requestSeq ref (latest-request-wins)
// - tableResetNonce: incrementing remounts SortableTable to reset persisted state
//   (spec §4.7 "Clear filters" clears BOTH q AND column filters)
//
// Spec §4.1, §4.4, §4.5, §4.7, §4.9, §4.10

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { User } from '../../lib/auth';
import { fetchActivity } from '../../lib/api';
import type { ActivityItem, FilterOptions } from '../../../../shared/types/operate';
import { PageShell } from '../../components/PageShell';
import { SortableTable, type ColumnDef } from '../../components/SortableTable';
import { SearchBox } from '../../components/SearchBox';
import { EmptyState } from '../../components/EmptyState';
import { Drawer } from '../../components/Drawer';
import { WorkspaceBadge } from '../../components/WorkspaceBadge';
import { relativeTime } from '../../lib/relativeTime';
import { SeverityLegend } from './components/SeverityLegend';
import { StatusDot, SeverityDot, TypeTag, formatType } from './components/ActivityRow';
import RunTraceModal from './components/RunTraceModal';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ActivityPageProps {
  user: User;
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

function buildColumns(
  filterOptions: FilterOptions | null,
  onRunIdClick: (runId: string) => void,
): ColumnDef<ActivityItem>[] {
  return [
    {
      key: 'subject',
      label: 'Subject',
      sortable: false,
      filterable: false,
      render: (item) => (
        <div className="flex flex-col gap-0.5 max-w-xs">
          <span
            className="text-sm text-slate-900 truncate"
            title={item.subject}
          >
            {item.subject}
          </span>
          {item.runId && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRunIdClick(item.runId!);
              }}
              className="font-mono text-xs text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none text-left"
              title={`View run trace: ${item.runId}`}
            >
              {item.runId.slice(0, 8)}&hellip;
            </button>
          )}
        </div>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      sortable: false,
      filterable: true,
      getValue: (item) => item.type,
      render: (item) => <TypeTag type={item.type} />,
      getFilterOptions: filterOptions
        ? () =>
            filterOptions.type.map((entry) => ({
              value: entry.value,
              label: entry.count > 0 ? `${entry.label} (${entry.count})` : entry.label,
            }))
        : undefined,
    },
    {
      key: 'status',
      label: 'Status',
      sortable: false,
      filterable: true,
      getValue: (item) => item.status,
      render: (item) => <StatusDot status={item.status} />,
      getFilterOptions: filterOptions
        ? () =>
            filterOptions.status.map((entry) => ({
              value: entry.value,
              label: entry.count > 0 ? `${entry.label} (${entry.count})` : entry.label,
            }))
        : undefined,
    },
    {
      key: 'severity',
      label: 'Severity',
      sortable: false,
      filterable: true,
      getValue: (item) => item.severity ?? '',
      render: (item) => <SeverityDot severity={item.severity} />,
      getFilterOptions: (_rows: ActivityItem[]) => [
        { value: 'critical', label: filterOptions ? formatFilterEntry(filterOptions, 'critical') : 'Critical' },
        { value: 'warning',  label: filterOptions ? formatFilterEntry(filterOptions, 'warning')  : 'Warning' },
        { value: 'info',     label: filterOptions ? formatFilterEntry(filterOptions, 'info')     : 'Info' },
      ],
    },
    {
      key: 'actor',
      label: 'Actor',
      sortable: false,
      filterable: true,
      getValue: (item) => item.actor,
      render: (item) => (
        <span className="text-sm text-slate-700 whitespace-nowrap">
          {item.actor || <span className="text-slate-400">—</span>}
        </span>
      ),
      getFilterOptions: filterOptions
        ? () =>
            filterOptions.actor.map((entry) => ({
              value: entry.value,
              label: entry.count > 0 ? `${entry.label} (${entry.count})` : entry.label,
            }))
        : undefined,
    },
    {
      key: 'workspace',
      label: 'Workspace',
      sortable: false,
      filterable: true,
      getValue: (item) => item.subaccountName ?? '',
      render: (item) =>
        item.subaccountId && item.subaccountName ? (
          <WorkspaceBadge clientId={item.subaccountId} clientName={item.subaccountName} />
        ) : (
          <span className="text-slate-400 text-sm">—</span>
        ),
      getFilterOptions: filterOptions
        ? () =>
            filterOptions.subaccount.map((entry) => ({
              value: entry.value,
              label: entry.count > 0 ? `${entry.label} (${entry.count})` : entry.label,
            }))
        : undefined,
    },
    {
      key: 'triggerSource',
      label: 'Trigger Source',
      sortable: false,
      filterable: false,
      getValue: (item) => item.triggerSource,
      render: (item) => (
        <span className="text-sm text-slate-600 whitespace-nowrap capitalize">
          {formatType(item.triggerSource)}
        </span>
      ),
    },
    {
      key: 'createdAt',
      label: 'Timestamp',
      sortable: true,
      filterable: false,
      getValue: (item) => item.createdAt,
      render: (item) => (
        <span
          className="text-xs text-slate-500 whitespace-nowrap"
          title={new Date(item.createdAt).toLocaleString()}
        >
          {relativeTime(item.createdAt)}
        </span>
      ),
    },
  ];
}

/**
 * Format a filter entry label from the server-supplied filterOptions for a
 * severity-level value. Falls back to the capitalised value if not found.
 */
function formatFilterEntry(filterOptions: FilterOptions, value: string): string {
  // Severity is not a top-level key on FilterOptions — we only have type, status, actor, subaccount.
  // Severity filter options are derived locally. Return just the capitalised label.
  void filterOptions; // filterOptions is referenced here for future extensibility
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// ---------------------------------------------------------------------------
// ActivityDrawerContent — rendered inside the Drawer
// ---------------------------------------------------------------------------

interface DrawerContentProps {
  item: ActivityItem;
  onRunIdClick: (runId: string) => void;
}

function DrawerRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <span className="w-28 shrink-0 text-xs font-medium text-slate-500 pt-0.5">{label}</span>
      <span className="flex-1 text-sm text-slate-800">{children}</span>
    </div>
  );
}

function ActivityDrawerContent({ item, onRunIdClick }: DrawerContentProps): React.ReactElement {
  return (
    <div className="flex flex-col">
      <h3 className="text-sm font-semibold text-slate-900 mb-4 leading-snug">{item.subject}</h3>

      <DrawerRow label="Type">
        <TypeTag type={item.type} />
      </DrawerRow>

      <DrawerRow label="Status">
        <StatusDot status={item.status} />
      </DrawerRow>

      <DrawerRow label="Severity">
        <SeverityDot severity={item.severity} />
      </DrawerRow>

      <DrawerRow label="Actor">
        {item.actor || <span className="text-slate-400">—</span>}
      </DrawerRow>

      {item.subaccountId && item.subaccountName && (
        <DrawerRow label="Workspace">
          <WorkspaceBadge clientId={item.subaccountId} clientName={item.subaccountName} />
        </DrawerRow>
      )}

      <DrawerRow label="Trigger">
        <span className="capitalize">{formatType(item.triggerSource)}</span>
        {item.triggerType && item.triggerType !== item.triggerSource && (
          <span className="text-slate-400 ml-1 text-xs">({item.triggerType})</span>
        )}
      </DrawerRow>

      {item.triggeredByUserName && (
        <DrawerRow label="Triggered by">
          {item.triggeredByUserName}
        </DrawerRow>
      )}

      <DrawerRow label="Created">
        <span title={new Date(item.createdAt).toLocaleString()}>
          {relativeTime(item.createdAt)}
        </span>
      </DrawerRow>

      {item.updatedAt && item.updatedAt !== item.createdAt && (
        <DrawerRow label="Updated">
          <span title={new Date(item.updatedAt).toLocaleString()}>
            {relativeTime(item.updatedAt)}
          </span>
        </DrawerRow>
      )}

      {item.durationMs !== null && item.durationMs !== undefined && (
        <DrawerRow label="Duration">
          {item.durationMs < 1000
            ? `${item.durationMs}ms`
            : `${(item.durationMs / 1000).toFixed(1)}s`}
        </DrawerRow>
      )}

      {item.agentName && (
        <DrawerRow label="Agent">
          {item.agentName}
        </DrawerRow>
      )}

      {item.runId && (
        <DrawerRow label="Run ID">
          <button
            type="button"
            onClick={() => onRunIdClick(item.runId!)}
            className="font-mono text-xs text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none"
            title="View run trace"
          >
            {item.runId}
          </button>
        </DrawerRow>
      )}

      {item.detailUrl && (
        <div className="mt-4">
          <a
            href={item.detailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-indigo-600 hover:text-indigo-800 hover:underline"
          >
            View full detail
          </a>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActivityPage
// ---------------------------------------------------------------------------

export function ActivityPage({ user }: ActivityPageProps): React.ReactElement {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search query
  const [q, setQ] = useState('');

  // Monotonic request sequence for stale-response guard
  const requestSeqRef = useRef(0);

  // tableResetNonce — incrementing forces SortableTable remount (clears persisted state)
  const [tableResetNonce, setTableResetNonce] = useState(0);

  // Drawer state
  const [drawerItem, setDrawerItem] = useState<ActivityItem | null>(null);

  // RunTraceModal state (opened from run-id link in table or drawer)
  const [traceRunId, setTraceRunId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const load = useCallback((searchQ: string) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);

    fetchActivity({ q: searchQ || undefined, limit: 200, sort: 'newest' })
      .then((data) => {
        // Stale-response guard: discard if a newer request has been dispatched
        if (requestSeqRef.current !== seq) return;
        setItems(data.items);
        setFilterOptions(data.filterOptions);
        setLoading(false);
      })
      .catch((err) => {
        if (requestSeqRef.current !== seq) return;
        console.error('[ActivityPage] fetchActivity error:', err);
        setError('Failed to load activity. Please try again.');
        setLoading(false);
      });
  }, []);

  // Initial load and on q change
  useEffect(() => {
    load(q);
  }, [load, q]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleClearFilters = useCallback(() => {
    // Clear search
    setQ('');
    // Increment nonce to remount SortableTable — this resets persisted column filter state
    // without writing directly to localStorage (spec §4.7 discipline)
    setTableResetNonce((n) => n + 1);
  }, []);

  const handleRowClick = useCallback((item: ActivityItem) => {
    setDrawerItem(item);
  }, []);

  // ---------------------------------------------------------------------------
  // Column definitions (memoised on filterOptions)
  // ---------------------------------------------------------------------------

  const columns = React.useMemo(
    () => buildColumns(filterOptions, (runId) => setTraceRunId(runId)),
    [filterOptions],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <PageShell
      header={
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold text-slate-900">Activity</h1>
        </div>
      }
    >
      <div className="p-6 flex flex-col gap-4">
        {/* Severity legend — sticky-dismissed per user */}
        <SeverityLegend userId={user.id} />

        {/* Search */}
        <div className="max-w-sm">
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="Search activity..."
            debounceMs={200}
            aria-label="Search activity"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && items.length === 0 && (
          <div className="text-sm text-slate-500 py-4">Loading activity...</div>
        )}

        {/* Table */}
        {!loading || items.length > 0 ? (
          <SortableTable<ActivityItem>
            key={`activity-${tableResetNonce}`}
            rows={items}
            columns={columns}
            rowKey={(item) => item.id}
            persistKey="operate-activity"
            initialSort={{ key: 'createdAt', dir: 'desc' }}
            onRowClick={handleRowClick}
            emptyState={
              <EmptyState
                title="No activity found"
                body={
                  q
                    ? `No results for "${q}". Try adjusting your search or clearing filters.`
                    : 'No activity to display. Try adjusting your filters.'
                }
                primaryAction={{
                  label: 'Clear filters',
                  onClick: handleClearFilters,
                }}
              />
            }
          />
        ) : null}
      </div>

      {/* Drawer — row click detail */}
      <Drawer
        open={!!drawerItem}
        onClose={() => setDrawerItem(null)}
        title="Activity Detail"
        width={480}
      >
        {drawerItem && (
          <ActivityDrawerContent
            item={drawerItem}
            onRunIdClick={(runId) => setTraceRunId(runId)}
          />
        )}
      </Drawer>

      {/* RunTraceModal — opened from run-id links */}
      {traceRunId && (
        <RunTraceModal runId={traceRunId} onClose={() => setTraceRunId(null)} />
      )}
    </PageShell>
  );
}

export default ActivityPage;
