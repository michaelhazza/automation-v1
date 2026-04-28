import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';

type ActivityType =
  | 'agent_run'
  | 'review_item'
  | 'health_finding'
  | 'inbox_item'
  | 'workflow_run'
  | 'workflow_execution';

type NormalisedStatus = 'active' | 'attention_needed' | 'completed' | 'failed' | 'cancelled';

type ActivityItem = {
  id: string;
  type: ActivityType;
  status: NormalisedStatus;
  subject: string;
  actor: string;
  subaccountId: string | null;
  subaccountName: string | null;
  agentId: string | null;
  agentName: string | null;
  severity: 'critical' | 'warning' | 'info' | null;
  createdAt: string;
  updatedAt: string;
  detailUrl: string;
};

const ACTIVITY_TYPES: ActivityType[] = [
  'agent_run', 'review_item', 'health_finding', 'inbox_item',
  'workflow_run', 'workflow_execution',
];

const STATUS_OPTIONS: NormalisedStatus[] = ['active', 'attention_needed', 'completed', 'failed', 'cancelled'];
const SEVERITY_OPTIONS = ['critical', 'warning', 'info'] as const;

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'severity', label: 'Severity' },
  { value: 'attention_first', label: 'Attention first' },
] as const;

function typeLabel(t: ActivityType): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusBadge(s: NormalisedStatus) {
  const map: Record<NormalisedStatus, { bg: string; text: string }> = {
    active: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
    attention_needed: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700' },
    completed: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
    failed: { bg: 'bg-red-50 border-red-200', text: 'text-red-700' },
    cancelled: { bg: 'bg-slate-50 border-slate-200', text: 'text-slate-500' },
  };
  const { bg, text } = map[s];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-full border ${bg} ${text}`}>
      {s.replace(/_/g, ' ')}
    </span>
  );
}

function severityBadge(sev: 'critical' | 'warning' | 'info' | null) {
  if (!sev) return <span className="text-slate-300 text-[12px]">--</span>;
  const map = {
    critical: 'bg-red-100 text-red-700 border-red-200',
    warning: 'bg-amber-100 text-amber-700 border-amber-200',
    info: 'bg-sky-50 text-sky-700 border-sky-200',
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10.5px] font-semibold rounded-full border ${map[sev]}`}>
      {sev}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

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
        {isSorted && <span className="text-indigo-500 text-[11px]">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>}
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
              <span className="text-[11px] w-3">{'\u2191'}</span> A {'\u2192'} Z
              {isSorted && sortDir === 'asc' && <span className="ml-auto text-indigo-500">{'\u2713'}</span>}
            </button>
            <button
              onClick={() => onSort(col as SortCol, 'desc')}
              className={`flex items-center gap-2 w-full px-2 py-1.5 text-[12px] rounded-md border-0 cursor-pointer transition-colors text-left ${isSorted && sortDir === 'desc' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-transparent text-slate-700 hover:bg-slate-50'}`}
            >
              <span className="text-[11px] w-3">{'\u2193'}</span> Z {'\u2192'} A
              {isSorted && sortDir === 'desc' && <span className="ml-auto text-indigo-500">{'\u2713'}</span>}
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
      <span className="text-slate-300 text-[11px]">{'\u00B7'}</span>
      <button onClick={onNone} className="text-[11px] text-indigo-600 hover:text-indigo-800 bg-transparent border-0 p-0 cursor-pointer">None</button>
    </div>
  );
}

interface HistoryTabProps {
  scope: 'org' | 'subaccount';
  subaccountId?: string;
}

export function HistoryTab({ scope, subaccountId }: HistoryTabProps) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [filterType, setFilterType] = useState<Set<ActivityType>>(new Set());
  const [filterStatus, setFilterStatus] = useState<Set<NormalisedStatus>>(new Set());
  const [filterSeverity, setFilterSeverity] = useState<Set<string>>(new Set());

  const [permissionDenied, setPermissionDenied] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('newest');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [openCol, setOpenCol] = useState<string | null>(null);

  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tableRef.current && !tableRef.current.contains(e.target as Node)) setOpenCol(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleFilter = <T extends string>(set: Set<T>, setFn: React.Dispatch<React.SetStateAction<Set<T>>>, val: T) => {
    setFn((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val); else next.add(val);
      return next;
    });
  };

  const getEndpoint = useCallback(() => {
    if (scope === 'subaccount' && subaccountId) return `/api/subaccounts/${subaccountId}/activity`;
    return '/api/activity';
  }, [scope, subaccountId]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { sort };
      if (q) params.q = q;
      if (from) params.from = from;
      if (to) params.to = to;
      const res = await api.get(getEndpoint(), { params });
      const data = scope === 'org'
        ? res.data.data
        : res.data;
      setPermissionDenied(false);
      setItems(data.items);
      setTotal(data.total);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) setPermissionDenied(true);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [getEndpoint, q, from, to, sort]);

  useEffect(() => { load(); }, [load]);

  const hasFilters = filterType.size > 0 || filterStatus.size > 0 || filterSeverity.size > 0 || q || from || to || sort !== 'newest';

  const clearAll = () => {
    setFilterType(new Set());
    setFilterStatus(new Set());
    setFilterSeverity(new Set());
    setQ('');
    setFrom('');
    setTo('');
    setSort('newest');
    setSortCol(null);
  };

  const handleSort = (col: SortCol, dir: SortDir) => {
    setSortCol(col);
    setSortDir(dir);
    setOpenCol(null);
  };

  const filtered = items.filter((item) => {
    if (filterType.has(item.type)) return false;
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

  if (permissionDenied) {
    return (
      <div className="rounded bg-yellow-50 border border-yellow-200 p-4 text-sm text-yellow-700">
        You do not have permission to view activity history. Contact your administrator to request the executions view permission.
      </div>
    );
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 mb-5">
        <div className="flex gap-3 flex-wrap items-end">
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
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13.5px] font-semibold rounded-lg transition-colors"
            >
              Apply
            </button>
            {hasFilters && (
              <button
                onClick={clearAll}
                className="px-4 py-2 text-slate-600 hover:text-slate-800 text-[13px] font-medium rounded-lg hover:bg-slate-100 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div ref={tableRef} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading && items.length === 0 ? (
          <div className="p-5 flex flex-col gap-2">
            {[1,2,3,4,5].map((i) => <div key={i} className="h-[52px] rounded-lg bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />)}
          </div>
        ) : displayed.length === 0 ? (
          <div className="p-12 flex flex-col items-center text-center">
            <p className="font-bold text-[16px] text-slate-900 mb-1.5">No activity found</p>
            <p className="text-[13.5px] text-slate-500 mb-5">
              {hasFilters ? 'Try adjusting your filters.' : 'Activity from agents and workflows will appear here.'}
            </p>
            {hasFilters && (
              <button onClick={clearAll} className="px-4 py-2 border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100">
              <span className="text-[13px] text-slate-500">{total} items</span>
              {(filterType.size > 0 || filterStatus.size > 0 || filterSeverity.size > 0 || sortCol) && (
                <button
                  onClick={clearAll}
                  className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-0 rounded-lg text-[12px] font-medium cursor-pointer transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
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
                    {ACTIVITY_TYPES.map((t) => (
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
              <tbody className="divide-y divide-slate-50">
                {displayed.map((item) => (
                  <tr key={`${item.type}-${item.id}`} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                        {typeLabel(item.type)}
                      </span>
                    </td>
                    <td className="px-4 py-3">{statusBadge(item.status)}</td>
                    <td className="px-4 py-3">
                      <Link
                        to={item.detailUrl}
                        className="text-indigo-600 hover:text-indigo-700 text-[13px] font-medium no-underline hover:underline"
                      >
                        {item.subject.length > 80 ? item.subject.slice(0, 80) + '...' : item.subject}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-slate-600">{item.actor}</td>
                    <td className="px-4 py-3">{severityBadge(item.severity)}</td>
                    {scope !== 'subaccount' && (
                      <td className="px-4 py-3 text-[13px] text-slate-500">
                        {item.subaccountName ?? <span className="text-slate-300">--</span>}
                      </td>
                    )}
                    <td className="px-4 py-3 text-[13px] text-slate-500">{formatDate(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
