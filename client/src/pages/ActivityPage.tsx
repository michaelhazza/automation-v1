import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, useParams, useLocation } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import ActivityFeedTable, { ActivityItem } from '../components/activity/ActivityFeedTable';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActivityType =
  | 'agent_run' | 'review_item' | 'health_finding' | 'inbox_item' | 'workflow_run' | 'workflow_execution'
  | 'email.sent' | 'email.received' | 'calendar.event_created' | 'calendar.event_accepted'
  | 'calendar.event_declined' | 'identity.provisioned' | 'identity.activated' | 'identity.suspended'
  | 'identity.resumed' | 'identity.revoked' | 'identity.archived' | 'identity.email_sending_enabled'
  | 'identity.email_sending_disabled' | 'identity.migrated' | 'identity.migration_failed'
  | 'identity.provisioning_failed' | 'actor.onboarded' | 'subaccount.migration_completed';

type NormalisedStatus = 'active' | 'attention_needed' | 'completed' | 'failed' | 'cancelled';

type Scope = 'subaccount' | 'org' | 'system';

type WorkspaceActor = {
  actorId: string;
  displayName: string;
};

// Core activity types (non-workspace)
const CORE_ACTIVITY_TYPES: ActivityType[] = [
  'agent_run', 'review_item', 'health_finding', 'inbox_item',
  'workflow_run', 'workflow_execution',
];

// Workspace event types
const WORKSPACE_ACTIVITY_TYPES: ActivityType[] = [
  'email.sent', 'email.received',
  'calendar.event_created', 'calendar.event_accepted', 'calendar.event_declined',
  'identity.provisioned', 'identity.activated', 'identity.suspended',
  'identity.resumed', 'identity.revoked', 'identity.archived',
  'identity.email_sending_enabled', 'identity.email_sending_disabled',
  'identity.migrated', 'identity.migration_failed', 'identity.provisioning_failed',
  'actor.onboarded', 'subaccount.migration_completed',
];

const ACTIVITY_TYPES: ActivityType[] = [...CORE_ACTIVITY_TYPES, ...WORKSPACE_ACTIVITY_TYPES];

const STATUS_OPTIONS: NormalisedStatus[] = ['active', 'attention_needed', 'completed', 'failed', 'cancelled'];

const SEVERITY_OPTIONS = ['critical', 'warning', 'info'] as const;

const SORT_OPTIONS = [
  { value: 'attention_first', label: 'Attention first' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'severity', label: 'Severity' },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function typeLabel(t: ActivityType): string {
  if (t.includes('.')) {
    const parts = t.split('.');
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  }
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Sub-components: Column header with sort + filter dropdowns
// ---------------------------------------------------------------------------

type SortCol = 'type' | 'status' | 'subject' | 'actor' | 'severity' | 'createdAt';
type SortDir = 'asc' | 'desc';

function ColHeader({
  label, col, openCol, sortCol, sortDir, hasActiveFilter,
  onToggleOpen, onSort, children,
}: {
  label: string;
  col: string;
  openCol: string | null;
  sortCol: SortCol | null;
  sortDir: SortDir;
  hasActiveFilter: boolean;
  onToggleOpen: (col: string) => void;
  onSort: (col: SortCol, dir: SortDir) => void;
  children?: React.ReactNode;
}) {
  const isOpen = openCol === col;
  const isSorted = sortCol === col;

  return (
    <th className="px-4 py-0 text-left relative" style={{ userSelect: 'none' }}>
      <button
        onClick={() => onToggleOpen(col)}
        className={`flex items-center gap-1.5 w-full py-3 bg-transparent border-0 cursor-pointer text-[13px] font-semibold text-left transition-colors ${isOpen ? 'text-indigo-600' : 'text-slate-700 hover:text-slate-900'}`}
      >
        <span>{label}</span>
        {isSorted && <span className="text-indigo-500 text-[11px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
        {hasActiveFilter && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />}
        <svg
          className={`ml-auto w-3 h-3 transition-transform ${isOpen ? 'rotate-180 text-indigo-500' : 'text-slate-400'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 min-w-[190px] bg-white border border-slate-200 rounded-lg shadow-lg py-1 mt-0.5">
          <div className="px-2 pt-1 pb-0.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-2 py-1">Sort</div>
            <button
              onClick={() => onSort(col as SortCol, 'asc')}
              className={`flex items-center gap-2 w-full px-2 py-1.5 text-[12px] rounded-md border-0 cursor-pointer transition-colors text-left ${isSorted && sortDir === 'asc' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-transparent text-slate-700 hover:bg-slate-50'}`}
            >
              <span className="text-[11px] w-3">{'↑'}</span> A {'→'} Z
              {isSorted && sortDir === 'asc' && <span className="ml-auto text-indigo-500">{'✓'}</span>}
            </button>
            <button
              onClick={() => onSort(col as SortCol, 'desc')}
              className={`flex items-center gap-2 w-full px-2 py-1.5 text-[12px] rounded-md border-0 cursor-pointer transition-colors text-left ${isSorted && sortDir === 'desc' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-transparent text-slate-700 hover:bg-slate-50'}`}
            >
              <span className="text-[11px] w-3">{'↓'}</span> Z {'→'} A
              {isSorted && sortDir === 'desc' && <span className="ml-auto text-indigo-500">{'✓'}</span>}
            </button>
          </div>
          {children && (
            <div className="border-t border-slate-100 mt-1 px-2 pt-1 pb-1">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-2 py-1">Filter</div>
              {children}
            </div>
          )}
        </div>
      )}
    </th>
  );
}

function CheckOption({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer text-[12px] text-slate-700">
      <input type="checkbox" checked={checked} onChange={onChange} className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer" />
      {label}
    </label>
  );
}

function FilterActions({ onAll, onNone }: { onAll: () => void; onNone: () => void }) {
  return (
    <div className="flex items-center gap-2 px-2 pb-1.5">
      <button onClick={onAll} className="text-[11px] text-indigo-600 hover:text-indigo-800 bg-transparent border-0 p-0 cursor-pointer">All</button>
      <span className="text-slate-300 text-[11px]">{'·'}</span>
      <button onClick={onNone} className="text-[11px] text-indigo-600 hover:text-indigo-800 bg-transparent border-0 p-0 cursor-pointer">None</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ActivityPage({ user }: { user: User }) {
  const { subaccountId: paramSubaccountId } = useParams<{ subaccountId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();

  // Determine scope from current route
  const scope: Scope = paramSubaccountId
    ? 'subaccount'
    : pathname.startsWith('/system/')
      ? 'system'
      : 'org';

  // Data state — DE-CR-7: cursor pagination only; `total` is not part of the
  // server contract any more, so the "X items" counter reflects items currently
  // loaded into the feed.
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Workspace actors (subaccount scope only)
  const [actors, setActors] = useState<WorkspaceActor[]>([]);

  // Client-side column filters — exclusion sets (values in set are HIDDEN)
  // Empty set = no filter (all values shown). Matches SystemSkillsPage ColHeader pattern.
  const [filterType, setFilterType] = useState<Set<ActivityType>>(new Set());
  const [filterStatus, setFilterStatus] = useState<Set<NormalisedStatus>>(new Set());
  const [filterSeverity, setFilterSeverity] = useState<Set<string>>(new Set());

  // Server-side filters
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [sort, setSort] = useState<string>(searchParams.get('sort') ?? 'attention_first');
  const [from, setFrom] = useState(searchParams.get('from') ?? '');
  const [to, setTo] = useState(searchParams.get('to') ?? '');
  const [filterActorId, setFilterActorId] = useState<string | undefined>(undefined);

  // Client-side column sort (applied on top of server sort)
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [openCol, setOpenCol] = useState<string | null>(null);

  const tableRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tableRef.current && !tableRef.current.contains(e.target as Node)) setOpenCol(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Fetch workspace actors for subaccount scope (for actor filter dropdown)
  // Uses the workspace identity list bundled in the existing workspace summary endpoint.
  // If no dedicated actors endpoint exists, the dropdown stays empty (shows "All actors" only).
  useEffect(() => {
    if (scope !== 'subaccount' || !paramSubaccountId) return;

    api.get(`/api/subaccounts/${paramSubaccountId}/workspace/actors`)
      .then((res) => {
        const data = res.data;
        if (Array.isArray(data)) {
          setActors(data as WorkspaceActor[]);
        }
      })
      .catch(() => {
        // Endpoint doesn't exist yet — actor dropdown shows "All actors" only
        setActors([]);
      });
  }, [scope, paramSubaccountId]);

  // Toggle filter helper
  const toggleFilter = <T extends string>(set: Set<T>, setFn: React.Dispatch<React.SetStateAction<Set<T>>>, val: T) => {
    setFn((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val); else next.add(val);
      return next;
    });
  };

  // Build endpoint
  const getEndpoint = useCallback(() => {
    if (scope === 'subaccount') return `/api/subaccounts/${paramSubaccountId}/activity`;
    if (scope === 'system') return '/api/system/activity';
    return '/api/activity';
  }, [scope, paramSubaccountId]);

  // Load data — server handles sort, search, and date range; column filters are client-side
  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { sort };
      if (q) params.q = q;
      if (from) params.from = from;
      if (to) params.to = to;
      if (filterActorId) params.actorId = filterActorId;

      const res = await api.get(getEndpoint(), { params });
      const data = scope === 'org'
        ? res.data.data
        : res.data;
      setItems(data.items ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [getEndpoint, q, from, to, sort, filterActorId]);

  // Initial load + polling every 10s
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  // Persist server-side filters to URL
  useEffect(() => {
    const p = new URLSearchParams();
    if (sort !== 'attention_first') p.set('sort', sort);
    if (q) p.set('q', q);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    setSearchParams(p, { replace: true });
  }, [sort, q, from, to, setSearchParams]);

  const hasFilters = filterType.size > 0 || filterStatus.size > 0 || filterSeverity.size > 0
    || q || from || to || sort !== 'attention_first' || !!filterActorId;
  const activeFilterCount = filterType.size + filterStatus.size + filterSeverity.size
    + (q ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0) + (filterActorId ? 1 : 0);

  const clearAll = () => {
    setFilterType(new Set());
    setFilterStatus(new Set());
    setFilterSeverity(new Set());
    setQ('');
    setFrom('');
    setTo('');
    setSort('attention_first');
    setSortCol(null);
    setFilterActorId(undefined);
  };

  // Client-side column sort
  const handleSort = (col: SortCol, dir: SortDir) => {
    setSortCol(col);
    setSortDir(dir);
    setOpenCol(null);
  };

  // Client-side exclusion filter: values in the set are HIDDEN
  const filtered = items.filter((item) => {
    if (filterType.has(item.type as ActivityType)) return false;
    if (filterStatus.has(item.status)) return false;
    if (item.severity && filterSeverity.has(item.severity)) return false;
    return true;
  });

  const displayed = sortCol
    ? [...filtered].sort((a, b) => {
        let cmp = 0;
        if (sortCol === 'type') cmp = a.type.localeCompare(b.type);
        else if (sortCol === 'status') cmp = a.status.localeCompare(b.status);
        else if (sortCol === 'subject') cmp = a.subject.localeCompare(b.subject);
        else if (sortCol === 'actor') cmp = a.actor.localeCompare(b.actor);
        else if (sortCol === 'severity') cmp = (a.severity ?? 'z').localeCompare(b.severity ?? 'z');
        else if (sortCol === 'createdAt') cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : filtered;

  const scopeLabel = scope === 'subaccount' ? 'Subaccount' : scope === 'system' ? 'System' : 'Organisation';

  // Selected actor display name
  const selectedActor = actors.find((a) => a.actorId === filterActorId);

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-slate-900 mb-0.5">Activity</h1>
          <p className="text-[13.5px] text-slate-500">{scopeLabel}-wide activity across all agents and workflows</p>
        </div>
        <div className="flex items-center gap-2">
          {(activeFilterCount > 0 || sortCol) && (
            <button
              onClick={clearAll}
              className="btn btn-sm btn-ghost"
            >
              Clear all
            </button>
          )}
          <span className="text-[13px] text-slate-500">{items.length} items</span>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 mb-5">
        <div className="flex gap-3 flex-wrap items-end">
          {/* Actor filter — subaccount scope only */}
          {scope === 'subaccount' && (
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Actor</label>
              <select
                value={filterActorId ?? ''}
                onChange={(e) => setFilterActorId(e.target.value || undefined)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All actors</option>
                {actors.map((a) => (
                  <option key={a.actorId} value={a.actorId}>{a.displayName}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex-1 min-w-[160px]">
            <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Search</label>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search subjects..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Sort</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[130px]">
            <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex-1 min-w-[130px]">
            <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-2 items-end">
            <button
              onClick={load}
              className="btn btn-primary"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Apply
            </button>
            {hasFilters && (
              <button
                onClick={clearAll}
                className="btn btn-ghost"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Column filters */}
      <div ref={tableRef} className="mb-3">
        <div className="bg-white border border-slate-200 rounded-xl overflow-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <ColHeader
                  label="Type" col="type" openCol={openCol} sortCol={sortCol} sortDir={sortDir}
                  hasActiveFilter={filterType.size > 0}
                  onToggleOpen={(c) => setOpenCol(openCol === c ? null : c)}
                  onSort={handleSort}
                >
                  <FilterActions
                    onAll={() => setFilterType(new Set())}
                    onNone={() => setFilterType(new Set(ACTIVITY_TYPES))}
                  />
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-2 py-1 mt-0.5">Core</div>
                  {CORE_ACTIVITY_TYPES.map((t) => (
                    <CheckOption
                      key={t}
                      checked={!filterType.has(t)}
                      onChange={() => toggleFilter(filterType, setFilterType, t)}
                      label={typeLabel(t)}
                    />
                  ))}
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-2 py-1 mt-0.5 border-t border-slate-100 pt-1.5">Workspace</div>
                  {WORKSPACE_ACTIVITY_TYPES.map((t) => (
                    <CheckOption
                      key={t}
                      checked={!filterType.has(t)}
                      onChange={() => toggleFilter(filterType, setFilterType, t)}
                      label={typeLabel(t)}
                    />
                  ))}
                </ColHeader>
                <ColHeader
                  label="Status" col="status" openCol={openCol} sortCol={sortCol} sortDir={sortDir}
                  hasActiveFilter={filterStatus.size > 0}
                  onToggleOpen={(c) => setOpenCol(openCol === c ? null : c)}
                  onSort={handleSort}
                >
                  <FilterActions
                    onAll={() => setFilterStatus(new Set())}
                    onNone={() => setFilterStatus(new Set(STATUS_OPTIONS))}
                  />
                  {STATUS_OPTIONS.map((s) => (
                    <CheckOption
                      key={s}
                      checked={!filterStatus.has(s)}
                      onChange={() => toggleFilter(filterStatus, setFilterStatus, s)}
                      label={s.replace(/_/g, ' ')}
                    />
                  ))}
                </ColHeader>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Subject</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Actor</th>
                <ColHeader
                  label="Severity" col="severity" openCol={openCol} sortCol={sortCol} sortDir={sortDir}
                  hasActiveFilter={filterSeverity.size > 0}
                  onToggleOpen={(c) => setOpenCol(openCol === c ? null : c)}
                  onSort={handleSort}
                >
                  <FilterActions
                    onAll={() => setFilterSeverity(new Set())}
                    onNone={() => setFilterSeverity(new Set(SEVERITY_OPTIONS as unknown as string[]))}
                  />
                  {SEVERITY_OPTIONS.map((s) => (
                    <CheckOption
                      key={s}
                      checked={!filterSeverity.has(s)}
                      onChange={() => toggleFilter(filterSeverity, setFilterSeverity, s)}
                      label={s}
                    />
                  ))}
                </ColHeader>
                {scope !== 'subaccount' && (
                  <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Subaccount</th>
                )}
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Created</th>
              </tr>
            </thead>
          </table>
        </div>
      </div>

      {/* Active filter summary */}
      {(filterActorId || filterType.size > 0 || filterStatus.size > 0 || filterSeverity.size > 0) && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {filterActorId && selectedActor && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 border border-indigo-200 rounded-full text-[12px] text-indigo-700 font-medium">
              Actor: {selectedActor.displayName}
              <button
                onClick={() => setFilterActorId(undefined)}
                className="bg-transparent border-0 p-0 cursor-pointer text-indigo-400 hover:text-indigo-700"
                aria-label="Remove actor filter"
              >
                &times;
              </button>
            </span>
          )}
          {filterType.size > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 border border-indigo-200 rounded-full text-[12px] text-indigo-700 font-medium">
              {filterType.size} type{filterType.size > 1 ? 's' : ''} hidden
              <button
                onClick={() => setFilterType(new Set())}
                className="bg-transparent border-0 p-0 cursor-pointer text-indigo-400 hover:text-indigo-700"
                aria-label="Clear type filter"
              >
                &times;
              </button>
            </span>
          )}
          {filterStatus.size > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 border border-indigo-200 rounded-full text-[12px] text-indigo-700 font-medium">
              {filterStatus.size} status{filterStatus.size > 1 ? 'es' : ''} hidden
              <button
                onClick={() => setFilterStatus(new Set())}
                className="bg-transparent border-0 p-0 cursor-pointer text-indigo-400 hover:text-indigo-700"
                aria-label="Clear status filter"
              >
                &times;
              </button>
            </span>
          )}
          {filterSeverity.size > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 border border-indigo-200 rounded-full text-[12px] text-indigo-700 font-medium">
              {filterSeverity.size} severit{filterSeverity.size > 1 ? 'ies' : 'y'} hidden
              <button
                onClick={() => setFilterSeverity(new Set())}
                className="bg-transparent border-0 p-0 cursor-pointer text-indigo-400 hover:text-indigo-700"
                aria-label="Clear severity filter"
              >
                &times;
              </button>
            </span>
          )}
        </div>
      )}

      {/* Table — rendered by ActivityFeedTable */}
      <ActivityFeedTable
        items={displayed}
        loading={loading}
      />
    </div>
  );
}
