// client/src/pages/govern/components/WebLoginsTab.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §5.1, §5.5, §5.6, §8.12, Chunk 9

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../../lib/api';
import { formatRelative } from './_utils';
import { AddWebLoginModal } from './AddWebLoginModal';
import { EditWebLoginModal } from './EditWebLoginModal';
import { TestWebLoginModal } from './TestWebLoginModal';
import { DisconnectConfirmDialog } from './DisconnectConfirmDialog';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WebLoginConfig {
  loginUrl: string;
  contentUrl?: string | null;
  username: string;
  usernameSelector?: string | null;
  passwordSelector?: string | null;
  submitSelector?: string | null;
  successSelector?: string | null;
  timeoutMs?: number | null;
  lastTestedAt?: string | null;
  lastTestStatus?: 'success' | 'failed' | 'untested' | null;
  lastTestError?: string | null;
}

export interface WebLoginConnection {
  id: string;
  label: string | null;
  displayName: string | null;
  organisationId: string;
  subaccountId: string | null;
  providerType: string;
  authType: string;
  connectionStatus: string;
  config: WebLoginConfig | null;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
}

// ── Status pill ───────────────────────────────────────────────────────────────

type WebLoginStatus = 'connected' | 'test_failed' | 'error' | 'untested';

function deriveStatus(row: WebLoginConnection): WebLoginStatus {
  if (row.connectionStatus === 'active' && row.config?.lastTestStatus === 'success') return 'connected';
  if (row.config?.lastTestStatus === 'failed') return 'test_failed';
  if (row.connectionStatus === 'error') return 'error';
  return 'untested';
}

function StatusPill({ row }: { row: WebLoginConnection }) {
  const status = deriveStatus(row);
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
        Connected
      </span>
    );
  }
  if (status === 'test_failed') {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
        Test failed
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
      Untested
    </span>
  );
}

// ── Username masking ──────────────────────────────────────────────────────────

function maskUsername(username: string): string {
  if (!username) return '';
  const atIdx = username.indexOf('@');
  const prefix = username.slice(0, 2);
  if (atIdx > 0) {
    const domain = username.slice(atIdx);
    return `${prefix}${'••••'}${domain}`;
  }
  return `${prefix}••••`;
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr>
      {[25, 20, 20, 18, 12, 5].map((w, i) => (
        <td key={i} className="px-4 py-3" style={{ width: `${w}%` }}>
          <div className="h-4 bg-slate-100 rounded animate-pulse" style={{ width: i === 0 ? '70%' : '80%' }} />
        </td>
      ))}
    </tr>
  );
}

// ── Row 3-dot menu ────────────────────────────────────────────────────────────

interface RowMenuProps {
  onTest: () => void;
  onEdit: () => void;
  onDisconnect: () => void;
}

function RowMenu({ onTest, onEdit, onDisconnect }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 border-0 bg-transparent cursor-pointer font-[inherit] transition-colors duration-100"
        aria-label="Row actions"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-10 min-w-[130px] bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          <button
            role="menuitem"
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onTest(); }}
            className="w-full text-left px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 border-0 bg-transparent cursor-pointer font-[inherit]"
          >
            Test
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onEdit(); }}
            className="w-full text-left px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 border-0 bg-transparent cursor-pointer font-[inherit]"
          >
            Edit
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onDisconnect(); }}
            className="w-full text-left px-3 py-2 text-[13px] text-red-600 hover:bg-red-50 border-0 bg-transparent cursor-pointer font-[inherit]"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sort state ────────────────────────────────────────────────────────────────

type SortKey = 'label' | 'loginUrl' | 'username' | 'status' | 'lastTestedAt';
type SortDir = 'asc' | 'desc';

function sortRows(rows: WebLoginConnection[], key: SortKey, dir: SortDir): WebLoginConnection[] {
  return [...rows].sort((a, b) => {
    let av = '';
    let bv = '';
    switch (key) {
      case 'label': av = (a.label ?? '').toLowerCase(); bv = (b.label ?? '').toLowerCase(); break;
      case 'loginUrl': av = (a.config?.loginUrl ?? '').toLowerCase(); bv = (b.config?.loginUrl ?? '').toLowerCase(); break;
      case 'username': av = (a.config?.username ?? '').toLowerCase(); bv = (b.config?.username ?? '').toLowerCase(); break;
      case 'status': av = deriveStatus(a); bv = deriveStatus(b); break;
      case 'lastTestedAt':
        av = a.config?.lastTestedAt ?? '';
        bv = b.config?.lastTestedAt ?? '';
        break;
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ── Status filter options ─────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'connected', label: 'Connected' },
  { value: 'test_failed', label: 'Test failed' },
  { value: 'untested', label: 'Untested' },
  { value: 'error', label: 'Error' },
];

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  subaccountId: string;
}

export function WebLoginsTab({ subaccountId }: Props) {
  const [rows, setRows] = useState<WebLoginConnection[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('label');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<WebLoginConnection | null>(null);
  const [testTarget, setTestTarget] = useState<WebLoginConnection | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<WebLoginConnection | null>(null);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    setRows(null);
    setError(null);
    api.get(`/api/subaccounts/${subaccountId}/web-login-connections`)
      .then((res) => setRows(res.data as WebLoginConnection[]))
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [subaccountId, refreshKey]);

  const isLoading = rows === null && !error;

  // Apply sort + filters
  const filtered = rows
    ? sortRows(
        rows.filter((r) => {
          if (statusFilter !== 'all') {
            if (deriveStatus(r) !== statusFilter) return false;
          }
          if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const inLabel = (r.label ?? '').toLowerCase().includes(q);
            const inUrl = (r.config?.loginUrl ?? '').toLowerCase().includes(q);
            if (!inLabel && !inUrl) return false;
          }
          return true;
        }),
        sortKey,
        sortDir,
      )
    : null;

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function ariaSortForKey(key: SortKey): React.AriaAttributes['aria-sort'] {
    if (sortKey !== key) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }

  const thClass = (key: SortKey) =>
    `px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide cursor-pointer select-none hover:bg-slate-100 transition-colors ${
      sortKey === key ? 'text-indigo-700' : 'text-slate-500'
    }`;

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className="ml-1 text-slate-300">&#8693;</span>;
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div>
      {/* Tab subtitle */}
      <p className="text-xs text-slate-400 mb-3 mt-1">
        Stored logins agents use to access paywalled sites
      </p>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 p-3 mb-3 bg-red-50 border border-red-200 rounded-lg text-[12.5px] text-red-700">
          <span className="flex-1">Failed to load web logins: {error.message}</span>
          <button
            type="button"
            onClick={reload}
            className="text-xs font-semibold text-red-700 underline cursor-pointer bg-transparent border-0 font-[inherit]"
          >
            Retry
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-[12.5px] border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-600 bg-white focus:outline-none focus:border-indigo-400 font-[inherit] cursor-pointer"
        >
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Search */}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by label or URL..."
          className="text-[12.5px] border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 bg-white focus:outline-none focus:border-indigo-400 font-[inherit] min-w-[180px]"
        />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Add CTA */}
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold border-0 cursor-pointer transition-colors duration-150 font-[inherit]"
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add Web Login
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {isLoading ? (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 w-[25%]">Label</th>
                <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 w-[20%]">Site</th>
                <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 w-[20%]">Username</th>
                <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 w-[18%]">Status</th>
                <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 w-[12%]">Last tested</th>
                <th className="px-4 py-2.5 w-[5%]" />
              </tr>
            </thead>
            <tbody>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </tbody>
          </table>
        ) : filtered && filtered.length === 0 ? (
          <div className="text-center py-14 px-8">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 mx-auto mb-4 flex items-center justify-center">
              <svg width="24" height="24" fill="none" stroke="#6366f1" strokeWidth="1.5" viewBox="0 0 24 24">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
            </div>
            {searchQuery || statusFilter !== 'all' ? (
              <>
                <p className="text-[15px] font-bold text-slate-900 mb-2">No results found.</p>
                <p className="text-[13px] text-slate-500 mb-4">Try adjusting your filters.</p>
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
                  className="text-indigo-600 underline text-[13px] cursor-pointer bg-transparent border-0 font-[inherit]"
                >
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <p className="text-[15px] font-bold text-slate-900 mb-2">No web logins yet.</p>
                <p className="text-[13px] text-slate-500 leading-relaxed max-w-sm mx-auto mb-5">
                  Add stored credentials so your agents can access paywalled sites automatically.
                </p>
                <button
                  type="button"
                  onClick={() => setShowAdd(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold border-0 cursor-pointer transition-colors duration-150 font-[inherit]"
                >
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Add Web Login
                </button>
              </>
            )}
          </div>
        ) : filtered && filtered.length > 0 ? (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th
                  role="columnheader"
                  aria-sort={ariaSortForKey('label')}
                  className={`${thClass('label')} w-[25%]`}
                  onClick={() => toggleSort('label')}
                >
                  Label<SortIcon col="label" />
                </th>
                <th
                  role="columnheader"
                  aria-sort={ariaSortForKey('loginUrl')}
                  className={`${thClass('loginUrl')} w-[20%]`}
                  onClick={() => toggleSort('loginUrl')}
                >
                  Site<SortIcon col="loginUrl" />
                </th>
                <th
                  role="columnheader"
                  aria-sort={ariaSortForKey('username')}
                  className={`${thClass('username')} w-[20%]`}
                  onClick={() => toggleSort('username')}
                >
                  Username<SortIcon col="username" />
                </th>
                <th
                  role="columnheader"
                  aria-sort={ariaSortForKey('status')}
                  className={`${thClass('status')} w-[18%]`}
                  onClick={() => toggleSort('status')}
                >
                  Status<SortIcon col="status" />
                </th>
                <th
                  role="columnheader"
                  aria-sort={ariaSortForKey('lastTestedAt')}
                  className={`${thClass('lastTestedAt')} w-[12%]`}
                  onClick={() => toggleSort('lastTestedAt')}
                >
                  Last tested<SortIcon col="lastTestedAt" />
                </th>
                <th className="px-4 py-2.5 w-[5%]" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-100 bg-white hover:bg-slate-50 transition-colors"
                >
                  <td className="px-4 py-3 text-[13px] font-medium text-slate-800">
                    {row.label ?? row.config?.loginUrl ?? 'Web Login'}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-slate-500 truncate max-w-[160px]">
                    {row.config?.loginUrl ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-slate-500 font-mono">
                    {row.config?.username ? maskUsername(row.config.username) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill row={row} />
                  </td>
                  <td className="px-4 py-3 text-[12px] text-slate-400">
                    {formatRelative(row.config?.lastTestedAt ?? null)}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <RowMenu
                      onTest={() => setTestTarget(row)}
                      onEdit={() => setEditTarget(row)}
                      onDisconnect={() => setDisconnectTarget(row)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      {/* Add modal */}
      {showAdd && (
        <AddWebLoginModal
          open={showAdd}
          subaccountId={subaccountId}
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); reload(); }}
        />
      )}

      {/* Edit modal */}
      {editTarget && (
        <EditWebLoginModal
          open={!!editTarget}
          subaccountId={subaccountId}
          connection={editTarget}
          onClose={() => setEditTarget(null)}
          onUpdated={() => { setEditTarget(null); reload(); }}
        />
      )}

      {/* Test modal */}
      {testTarget && (
        <TestWebLoginModal
          open={!!testTarget}
          subaccountId={subaccountId}
          connection={testTarget}
          onClose={() => setTestTarget(null)}
        />
      )}

      {/* Disconnect dialog */}
      {disconnectTarget && (
        <DisconnectConfirmDialog
          connectionId={disconnectTarget.id}
          onClose={() => setDisconnectTarget(null)}
          onDisconnected={() => { setDisconnectTarget(null); reload(); }}
        />
      )}
    </div>
  );
}
