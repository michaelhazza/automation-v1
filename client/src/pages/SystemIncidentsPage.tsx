import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';
import {
  IncidentDetailDrawer,
  SeverityBadge,
  StatusBadge,
  type SystemIncident,
} from '../components/system-incidents/IncidentDetailDrawer';

type SortCol = 'severity' | 'status' | 'source' | 'summary' | 'occurrenceCount' | 'firstSeenAt' | 'lastSeenAt';
type SortDir = 'asc' | 'desc';

const SEVERITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const STATUS_ORDER: Record<string, number> = { escalated: 6, open: 5, remediating: 4, investigating: 3, resolved: 2, suppressed: 1 };

// ─── ColHeader ────────────────────────────────────────────────────────────────

interface ColHeaderProps {
  label: string;
  col: SortCol;
  openCol: SortCol | null;
  sortCol: SortCol | null;
  sortDir: SortDir;
  hasActiveFilter?: boolean;
  onToggleOpen: (col: SortCol) => void;
  onSort: (col: SortCol, dir: SortDir) => void;
  children?: React.ReactNode;
}

function ColHeader({ label, col, openCol, sortCol, sortDir, hasActiveFilter = false, onToggleOpen, onSort, children }: ColHeaderProps) {
  const isOpen = openCol === col;
  const isSorted = sortCol === col;
  const ref = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onToggleOpen(col);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, col, onToggleOpen]);

  return (
    <th className="px-4 py-0 text-left relative" ref={ref} style={{ userSelect: 'none' }}>
      <button
        onClick={() => onToggleOpen(col)}
        className={`flex items-center gap-1.5 w-full py-3 bg-transparent border-0 cursor-pointer text-[13px] font-semibold text-left transition-colors ${isOpen ? 'text-indigo-600' : 'text-slate-700 hover:text-slate-900'}`}
      >
        <span>{label}</span>
        {isSorted && <span className="text-indigo-500 text-[11px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
        {hasActiveFilter && !isSorted && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />}
      </button>
      {isOpen && (
        <div className="absolute left-0 top-full z-50 bg-white border border-slate-200 rounded-lg shadow-lg p-2 min-w-[140px]">
          <button onClick={() => { onSort(col, 'asc'); onToggleOpen(col); }} className="flex items-center gap-2 w-full px-2 py-1.5 text-[12px] text-left hover:bg-slate-50 rounded text-slate-700">
            <span>↑</span> Sort A → Z
          </button>
          <button onClick={() => { onSort(col, 'desc'); onToggleOpen(col); }} className="flex items-center gap-2 w-full px-2 py-1.5 text-[12px] text-left hover:bg-slate-50 rounded text-slate-700">
            <span>↓</span> Sort Z → A
          </button>
          {children && <div className="border-t border-slate-100 mt-1 pt-1">{children}</div>}
        </div>
      )}
    </th>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SystemIncidentsPage() {
  const [incidents, setIncidents] = useState<SystemIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCol, setOpenCol] = useState<SortCol | null>(null);
  const [sortCol, setSortCol] = useState<SortCol | null>('lastSeenAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(['open', 'investigating', 'remediating', 'escalated']));
  const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set());
  const [selectedIncident, setSelectedIncident] = useState<SystemIncident | null>(null);
  const [badgeCount, setBadgeCount] = useState(0);

  const fetchIncidents = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter.size > 0) params.set('status', [...statusFilter].join(','));
      const { data } = await api.get(`/api/system/incidents?${params.toString()}`);
      setIncidents(data.incidents ?? []);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchBadge = useCallback(async () => {
    try {
      const { data } = await api.get('/api/system/incidents/badge-count');
      setBadgeCount(data.count ?? 0);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchIncidents(); fetchBadge(); }, [fetchIncidents, fetchBadge]);

  const allSources = [...new Set(incidents.map((i) => i.source))].sort();
  const allSeverities = ['critical', 'high', 'medium', 'low'];
  const allStatuses = ['open', 'investigating', 'remediating', 'escalated', 'resolved', 'suppressed'];

  function toggleFilter<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  }

  const sorted = [...incidents].sort((a, b) => {
    if (!sortCol) return 0;
    const av: string | number =
      sortCol === 'severity' ? (SEVERITY_ORDER[a.severity] ?? 0) :
      sortCol === 'status' ? (STATUS_ORDER[a.status] ?? 0) :
      sortCol === 'occurrenceCount' ? a.occurrenceCount :
      (sortCol === 'firstSeenAt' || sortCol === 'lastSeenAt') ? new Date(a[sortCol]).getTime() :
      ((a[sortCol] as string) ?? '');
    const bv: string | number =
      sortCol === 'severity' ? (SEVERITY_ORDER[b.severity] ?? 0) :
      sortCol === 'status' ? (STATUS_ORDER[b.status] ?? 0) :
      sortCol === 'occurrenceCount' ? b.occurrenceCount :
      (sortCol === 'firstSeenAt' || sortCol === 'lastSeenAt') ? new Date(b[sortCol]).getTime() :
      ((b[sortCol] as string) ?? '');
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  }).filter((i) => {
    if (severityFilter.size > 0 && !severityFilter.has(i.severity)) return false;
    if (sourceFilter.size > 0 && !sourceFilter.has(i.source)) return false;
    return true;
  });

  const handleSort = (col: SortCol, dir: SortDir) => { setSortCol(col); setSortDir(dir); };
  const handleToggleOpen = (col: SortCol) => setOpenCol((c) => (c === col ? null : col));

  const hasAnyFilter = statusFilter.size < allStatuses.length || severityFilter.size > 0 || sourceFilter.size > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-[16px] font-semibold text-slate-800">System Incidents</h1>
          {badgeCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold">
              {badgeCount > 99 ? '99+' : badgeCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasAnyFilter && (
            <button
              onClick={() => { setStatusFilter(new Set(['open', 'investigating', 'remediating', 'escalated'])); setSeverityFilter(new Set()); setSourceFilter(new Set()); }}
              className="btn btn-sm btn-ghost"
            >
              Clear all
            </button>
          )}
          <button onClick={fetchIncidents} className="btn btn-sm btn-secondary">
            Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="px-6 py-8 text-slate-400 text-[13px]">Loading...</div>
        ) : incidents.length === 0 ? (
          <div className="px-6 py-8 text-slate-400 text-[13px]">No incidents found.</div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
              <tr>
                <ColHeader label="Severity" col="severity" openCol={openCol} sortCol={sortCol} sortDir={sortDir} hasActiveFilter={severityFilter.size > 0} onToggleOpen={handleToggleOpen} onSort={handleSort}>
                  {allSeverities.map((s) => (
                    <label key={s} className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-slate-50 rounded text-[12px] text-slate-700">
                      <input type="checkbox" checked={severityFilter.has(s)} onChange={() => setSeverityFilter(toggleFilter(severityFilter, s))} className="rounded" />
                      {s}
                    </label>
                  ))}
                </ColHeader>
                <ColHeader label="Status" col="status" openCol={openCol} sortCol={sortCol} sortDir={sortDir} hasActiveFilter={statusFilter.size < allStatuses.length} onToggleOpen={handleToggleOpen} onSort={handleSort}>
                  {allStatuses.map((s) => (
                    <label key={s} className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-slate-50 rounded text-[12px] text-slate-700">
                      <input type="checkbox" checked={statusFilter.has(s)} onChange={() => setStatusFilter(toggleFilter(statusFilter, s))} className="rounded" />
                      {s}
                    </label>
                  ))}
                </ColHeader>
                <ColHeader label="Source" col="source" openCol={openCol} sortCol={sortCol} sortDir={sortDir} hasActiveFilter={sourceFilter.size > 0} onToggleOpen={handleToggleOpen} onSort={handleSort}>
                  {allSources.map((s) => (
                    <label key={s} className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-slate-50 rounded text-[12px] text-slate-700">
                      <input type="checkbox" checked={sourceFilter.has(s)} onChange={() => setSourceFilter(toggleFilter(sourceFilter, s))} className="rounded" />
                      {s}
                    </label>
                  ))}
                </ColHeader>
                <ColHeader label="Summary" col="summary" openCol={openCol} sortCol={sortCol} sortDir={sortDir} onToggleOpen={handleToggleOpen} onSort={handleSort} />
                <ColHeader label="Count" col="occurrenceCount" openCol={openCol} sortCol={sortCol} sortDir={sortDir} onToggleOpen={handleToggleOpen} onSort={handleSort} />
                <ColHeader label="First seen" col="firstSeenAt" openCol={openCol} sortCol={sortCol} sortDir={sortDir} onToggleOpen={handleToggleOpen} onSort={handleSort} />
                <ColHeader label="Last seen" col="lastSeenAt" openCol={openCol} sortCol={sortCol} sortDir={sortDir} onToggleOpen={handleToggleOpen} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((incident) => (
                <tr
                  key={incident.id}
                  onClick={() => setSelectedIncident(incident)}
                  className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                >
                  <td className="px-4 py-2.5"><SeverityBadge severity={incident.severity} /></td>
                  <td className="px-4 py-2.5"><StatusBadge status={incident.status} /></td>
                  <td className="px-4 py-2.5 text-[12px] text-slate-600 font-mono">{incident.source}</td>
                  <td className="px-4 py-2.5 text-[13px] text-slate-800 max-w-[320px] truncate">{incident.summary}</td>
                  <td className="px-4 py-2.5 text-[12px] text-slate-700 font-semibold">{incident.occurrenceCount}</td>
                  <td className="px-4 py-2.5 text-[12px] text-slate-500">{new Date(incident.firstSeenAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 text-[12px] text-slate-500">{new Date(incident.lastSeenAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedIncident && (
        <IncidentDetailDrawer
          incident={selectedIncident}
          onClose={() => setSelectedIncident(null)}
          onRefresh={() => { fetchIncidents(); fetchBadge(); setSelectedIncident(null); }}
        />
      )}
    </div>
  );
}
