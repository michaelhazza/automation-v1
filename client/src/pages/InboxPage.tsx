import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

type InboxTab = 'all' | 'tasks' | 'reviews' | 'failed_runs';

type SortOption = 'recent' | 'oldest' | 'priority' | 'type' | 'subaccount';

interface SortConfig {
  label: string;
  sortBy: string;
  sortDirection?: string;
}

interface InboxItem {
  id: string;
  type: 'task' | 'review' | 'failed_run';
  title: string;
  subtitle: string | null;
  status: string;
  isRead: boolean;
  isArchived: boolean;
  timestamp: string;
  entityId: string;
  subaccountId: string;
  subaccountName?: string;
  agentRunId?: string | null;
  priority?: string | null;
}

interface InboxCounts {
  all: number;
  tasks: number;
  reviews: number;
  failed_runs: number;
}

interface Subaccount {
  id: string;
  name: string;
  slug: string;
  status: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TYPE_ICON: Record<string, React.ReactNode> = {
  task: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
    </svg>
  ),
  review: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  ),
  failed_run: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
};

const STATUS_BADGE: Record<string, string> = {
  inbox: 'bg-blue-100 text-blue-700',
  pending: 'bg-amber-100 text-amber-700',
  edited_pending: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-indigo-100 text-indigo-700',
  failed: 'bg-red-100 text-red-700',
  error: 'bg-red-100 text-red-700',
  completed: 'bg-green-100 text-green-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-slate-100 text-slate-600',
};

const TAB_CONFIG: { key: InboxTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'failed_runs', label: 'Failed Runs' },
];

const SORT_OPTIONS: Record<SortOption, SortConfig> = {
  recent: { label: 'Most Recent', sortBy: 'updatedAt', sortDirection: 'desc' },
  oldest: { label: 'Oldest First', sortBy: 'updatedAt', sortDirection: 'asc' },
  priority: { label: 'Priority', sortBy: 'priority', sortDirection: 'asc' },
  type: { label: 'Type', sortBy: 'type', sortDirection: undefined },
  subaccount: { label: 'Subaccount', sortBy: 'subaccount', sortDirection: undefined },
};

const SORT_KEYS: SortOption[] = ['recent', 'oldest', 'priority', 'type', 'subaccount'];

// ── Colour from name hash ───────────────────────────────────────────────────

const SUBACCOUNT_PALETTE = [
  { dot: 'bg-indigo-500', badge: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  { dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
  { dot: 'bg-rose-500', badge: 'bg-rose-50 text-rose-700 ring-rose-200' },
  { dot: 'bg-cyan-500', badge: 'bg-cyan-50 text-cyan-700 ring-cyan-200' },
  { dot: 'bg-violet-500', badge: 'bg-violet-50 text-violet-700 ring-violet-200' },
  { dot: 'bg-orange-500', badge: 'bg-orange-50 text-orange-700 ring-orange-200' },
  { dot: 'bg-teal-500', badge: 'bg-teal-50 text-teal-700 ring-teal-200' },
  { dot: 'bg-pink-500', badge: 'bg-pink-50 text-pink-700 ring-pink-200' },
  { dot: 'bg-sky-500', badge: 'bg-sky-50 text-sky-700 ring-sky-200' },
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getSubaccountColour(name: string) {
  return SUBACCOUNT_PALETTE[hashString(name) % SUBACCOUNT_PALETTE.length];
}

// ── Unread left-border colour by type ───────────────────────────────────────

const UNREAD_BORDER: Record<string, string> = {
  task: 'border-l-indigo-500',
  review: 'border-l-amber-500',
  failed_run: 'border-l-red-500',
};

// ── Shimmer loading skeleton ─────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-[72px] rounded-lg bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
      ))}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: InboxTab }) {
  const messages: Record<InboxTab, { heading: string; body: string }> = {
    all: { heading: 'Inbox is empty', body: 'No tasks, reviews, or failed runs to show.' },
    tasks: { heading: 'No tasks', body: 'Tasks assigned to your AI team will appear here.' },
    reviews: { heading: 'No pending reviews', body: 'Agent actions awaiting approval will appear here.' },
    failed_runs: { heading: 'No failed runs', body: 'Agent runs that encountered errors will appear here.' },
  };
  const msg = messages[tab];
  return (
    <div className="py-16 text-center bg-white border border-slate-200 rounded-xl">
      <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-[linear-gradient(135deg,#f0fdf4,#dcfce7)]">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <p className="font-bold text-[16px] text-slate-900 mb-1.5">{msg.heading}</p>
      <p className="text-[13.5px] text-slate-500">{msg.body}</p>
    </div>
  );
}

// ── Subaccount group header ─────────────────────────────────────────────────

function SubaccountGroupHeader({ name }: { name: string }) {
  const colour = getSubaccountColour(name);
  return (
    <div className="flex items-center gap-2 py-2 px-1 mt-3 first:mt-0">
      <span className={`w-2.5 h-2.5 rounded-full ${colour.dot} shrink-0`} />
      <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">{name}</span>
      <div className="flex-1 h-px bg-slate-100" />
    </div>
  );
}

// ── Subaccount badge pill ───────────────────────────────────────────────────

function SubaccountBadge({ name }: { name: string }) {
  const colour = getSubaccountColour(name);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium ring-1 ${colour.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${colour.dot}`} />
      {name}
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function InboxPage({ user: _user }: { user: { id: string; role: string } }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const navigate = useNavigate();

  // State
  const [tab, setTab] = useState<InboxTab>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [items, setItems] = useState<InboxItem[]>([]);
  const [counts, setCounts] = useState<InboxCounts>({ all: 0, tasks: 0, reviews: 0, failed_runs: 0 });
  const [loading, setLoading] = useState(true);
  const [countsLoading, setCountsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());
  const [markAllLoading, setMarkAllLoading] = useState(false);
  const [error, setError] = useState('');

  // New filter/sort state
  const [subaccounts, setSubaccounts] = useState<Subaccount[]>([]);
  const [selectedSubaccountId, setSelectedSubaccountId] = useState<string>('');
  const [sortOption, setSortOption] = useState<SortOption>('recent');

  // Whether this is org-wide or per-subaccount
  const isOrgWide = !subaccountId;

  // ── Fetch subaccounts for filter (org-wide only) ─────────────────────────

  useEffect(() => {
    if (!isOrgWide) return;
    api.get('/api/subaccounts')
      .then(({ data }) => setSubaccounts(data))
      .catch(() => setSubaccounts([]));
  }, [isOrgWide]);

  // ── Debounced search ─────────────────────────────────────────────────────

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // ── Data fetching ────────────────────────────────────────────────────────

  const buildUrl = useCallback(
    (path: string) => {
      if (subaccountId) return `/api/subaccounts/${subaccountId}${path}`;
      return `/api${path}`;
    },
    [subaccountId],
  );

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = { tab };
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();

      // Subaccount filter (org-wide only)
      if (isOrgWide && selectedSubaccountId) {
        params.subaccountIds = selectedSubaccountId;
      }

      // Sort params
      const sortCfg = SORT_OPTIONS[sortOption];
      params.sortBy = sortCfg.sortBy;
      if (sortCfg.sortDirection) params.sortDirection = sortCfg.sortDirection;

      const res = await api.get(buildUrl('/inbox/unified'), { params });
      setItems(res.data as InboxItem[]);
    } catch {
      setError('Failed to load inbox items.');
    } finally {
      setLoading(false);
    }
  }, [tab, debouncedSearch, buildUrl, isOrgWide, selectedSubaccountId, sortOption]);

  const loadCounts = useCallback(async () => {
    setCountsLoading(true);
    try {
      const params: Record<string, string> = {};
      if (isOrgWide && selectedSubaccountId) {
        params.subaccountIds = selectedSubaccountId;
      }
      const res = await api.get(buildUrl('/inbox/counts'), { params });
      setCounts(res.data as InboxCounts);
    } catch {
      // Silently fail — counts are supplementary
    } finally {
      setCountsLoading(false);
    }
  }, [buildUrl, isOrgWide, selectedSubaccountId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleMarkRead = async (itemId: string) => {
    setActionLoading((prev) => new Set(prev).add(itemId));
    try {
      const item = items.find((i) => i.id === itemId);
      if (!item) return;
      await api.post(buildUrl('/inbox/mark-read'), { items: [{ entityType: item.type === 'review' ? 'review_item' : item.type === 'failed_run' ? 'agent_run' : 'task', entityId: item.entityId }] });
      setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, isRead: true } : i)));
      setCounts((prev) => ({
        ...prev,
        all: Math.max(0, prev.all - 1),
        [items.find((i) => i.id === itemId)?.type === 'task' ? 'tasks' : items.find((i) => i.id === itemId)?.type === 'review' ? 'reviews' : 'failed_runs']: Math.max(0, (prev as Record<string, number>)[items.find((i) => i.id === itemId)?.type === 'task' ? 'tasks' : items.find((i) => i.id === itemId)?.type === 'review' ? 'reviews' : 'failed_runs'] - 1),
      }));
    } catch {
      setError('Failed to mark as read.');
    } finally {
      setActionLoading((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  const handleArchive = async (itemId: string) => {
    setActionLoading((prev) => new Set(prev).add(itemId));
    try {
      const archiveItem = items.find((i) => i.id === itemId);
      if (!archiveItem) return;
      await api.post(buildUrl('/inbox/archive'), { items: [{ entityType: archiveItem.type === 'review' ? 'review_item' : archiveItem.type === 'failed_run' ? 'agent_run' : 'task', entityId: archiveItem.entityId }] });
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      loadCounts();
    } catch {
      setError('Failed to archive item.');
    } finally {
      setActionLoading((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  const handleMarkAllRead = async () => {
    setMarkAllLoading(true);
    try {
      const unreadIds = items.filter((i) => !i.isRead).map((i) => i.id);
      if (unreadIds.length === 0) return;
      const unreadItems = items.filter((i) => !i.isRead).map((i) => ({
        entityType: i.type === 'review' ? 'review_item' as const : i.type === 'failed_run' ? 'agent_run' as const : 'task' as const,
        entityId: i.entityId,
      }));
      if (unreadItems.length === 0) return;
      await api.post(buildUrl('/inbox/mark-read'), { items: unreadItems });
      setItems((prev) => prev.map((i) => ({ ...i, isRead: true })));
      loadCounts();
    } catch {
      setError('Failed to mark all as read.');
    } finally {
      setMarkAllLoading(false);
    }
  };

  const handleNavigate = (item: InboxItem) => {
    const saId = item.subaccountId;
    switch (item.type) {
      case 'task':
        navigate(`/admin/subaccounts/${saId}/workspace`);
        break;
      case 'review':
        navigate(`/admin/subaccounts/${saId}/review-queue`);
        break;
      case 'failed_run':
        if (item.agentRunId) {
          navigate(`/admin/subaccounts/${saId}/runs/${item.agentRunId}`);
        } else {
          navigate(`/admin/subaccounts/${saId}/workspace`);
        }
        break;
    }
  };

  // ── Relative time formatting ─────────────────────────────────────────────

  const formatRelativeTime = (timestamp: string) => {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  // ── Unread count for current tab ─────────────────────────────────────────

  const unreadCount = items.filter((i) => !i.isRead).length;

  // ── Grouped items when sorted by subaccount ──────────────────────────────

  const isSortedBySubaccount = sortOption === 'subaccount';

  const groupedItems = useMemo(() => {
    if (!isSortedBySubaccount || !isOrgWide) return null;

    const groups: { name: string; items: InboxItem[] }[] = [];
    let currentName = '';
    for (const item of items) {
      const name = item.subaccountName || 'Unknown';
      if (name !== currentName) {
        groups.push({ name, items: [item] });
        currentName = name;
      } else {
        groups[groups.length - 1].items.push(item);
      }
    }
    return groups;
  }, [items, isSortedBySubaccount, isOrgWide]);

  // ── Render a single inbox item row ───────────────────────────────────────

  const renderItem = (item: InboxItem, showSubaccountBadge: boolean) => {
    const isItemLoading = actionLoading.has(item.id);
    const badgeCls = STATUS_BADGE[item.status] ?? 'bg-slate-100 text-slate-600';
    const borderCls = !item.isRead ? UNREAD_BORDER[item.type] || 'border-l-indigo-500' : '';

    return (
      <div
        key={item.id}
        className={`flex items-center gap-3 p-4 bg-white border border-slate-200 rounded-lg hover:border-slate-300 transition-colors group ${
          isItemLoading ? 'opacity-60 pointer-events-none' : ''
        } ${!item.isRead ? `border-l-[3px] ${borderCls}` : ''}`}
      >
        {/* Unread dot */}
        <div className="w-2.5 shrink-0 flex justify-center">
          {!item.isRead && (
            <span className="w-2 h-2 rounded-full bg-indigo-500" />
          )}
        </div>

        {/* Type icon */}
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-slate-50 border border-slate-100 shrink-0">
          {TYPE_ICON[item.type] ?? TYPE_ICON.task}
        </div>

        {/* Content — clickable */}
        <button
          onClick={() => handleNavigate(item)}
          className="flex-1 min-w-0 text-left bg-transparent border-0 cursor-pointer p-0 [font-family:inherit]"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[14px] text-slate-900 truncate">{item.title}</span>
            <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${badgeCls}`}>
              {item.status.replace(/_/g, ' ')}
            </span>
            {showSubaccountBadge && item.subaccountName && (
              <SubaccountBadge name={item.subaccountName} />
            )}
          </div>
          {item.subtitle && (
            <p className="text-[13px] text-slate-500 m-0 mt-0.5 truncate">{item.subtitle}</p>
          )}
        </button>

        {/* Timestamp */}
        <span className="text-[12px] text-slate-400 whitespace-nowrap shrink-0">
          {formatRelativeTime(item.timestamp)}
        </span>

        {/* Actions */}
        <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {!item.isRead && (
            <button
              onClick={(e) => { e.stopPropagation(); handleMarkRead(item.id); }}
              title="Mark as read"
              disabled={isItemLoading}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-transparent hover:bg-slate-100 border-0 cursor-pointer text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleArchive(item.id); }}
            title="Archive"
            disabled={isItemLoading}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-transparent hover:bg-slate-100 border-0 cursor-pointer text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      {/* Header */}
      <div className="mb-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-[24px] font-bold text-slate-900 mt-0 mb-1">Inbox</h1>
            <p className="text-[14px] text-slate-500 m-0">
              {isOrgWide
                ? 'Tasks, reviews, and failed runs across all companies.'
                : 'Tasks, reviews, and failed runs for this company.'}
            </p>
          </div>
          <div className="flex gap-2 items-center">
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                disabled={markAllLoading}
                className="px-4 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-[13px] text-slate-600 font-medium cursor-pointer transition-colors disabled:opacity-50"
              >
                {markAllLoading ? 'Marking...' : `Mark all read (${unreadCount})`}
              </button>
            )}
            <button
              onClick={() => { loadItems(); loadCounts(); }}
              className="px-4 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-[13px] text-slate-600 cursor-pointer transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg mb-4 text-[14px] flex justify-between items-center">
          {error}
          <button onClick={() => setError('')} className="bg-transparent border-0 cursor-pointer text-red-700 text-lg leading-none">&times;</button>
        </div>
      )}

      {/* Search + Filters row */}
      <div className="mb-4 flex gap-3 items-center">
        {/* Search */}
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search inbox..."
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          />
        </div>

        {/* Subaccount filter (org-wide only) */}
        {isOrgWide && (
          <div className="relative shrink-0">
            <select
              value={selectedSubaccountId}
              onChange={(e) => setSelectedSubaccountId(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2.5 border border-slate-200 rounded-lg text-[13px] text-slate-700 bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
            >
              <option value="">All Subaccounts</option>
              {subaccounts.map((sa) => (
                <option key={sa.id} value={sa.id}>
                  {sa.name}
                </option>
              ))}
            </select>
            <svg
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        )}

        {/* Sort dropdown */}
        <div className="relative shrink-0">
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as SortOption)}
            className="appearance-none pl-3 pr-8 py-2.5 border border-slate-200 rounded-lg text-[13px] text-slate-700 bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
          >
            {SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {SORT_OPTIONS[key].label}
              </option>
            ))}
          </select>
          <svg
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {/* Active filter indicator */}
      {isOrgWide && selectedSubaccountId && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-[12px] text-slate-500">Filtered by:</span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-[12px] font-medium ring-1 ring-indigo-200">
            <span className={`w-2 h-2 rounded-full ${getSubaccountColour(subaccounts.find((s) => s.id === selectedSubaccountId)?.name || '').dot}`} />
            {subaccounts.find((s) => s.id === selectedSubaccountId)?.name || 'Subaccount'}
            <button
              onClick={() => setSelectedSubaccountId('')}
              className="ml-0.5 bg-transparent border-0 cursor-pointer text-indigo-400 hover:text-indigo-700 text-[14px] leading-none p-0"
            >
              &times;
            </button>
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-6 w-fit">
        {TAB_CONFIG.map(({ key, label }) => {
          const count = countsLoading ? null : counts[key];
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors border-0 cursor-pointer ${
                tab === key
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'bg-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
              {count !== null && count > 0 && (
                <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[11px] font-bold ${
                  key === 'failed_runs' ? 'bg-red-100 text-red-700' : 'bg-indigo-100 text-indigo-700'
                }`}>
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <LoadingSkeleton />
      ) : items.length === 0 ? (
        <EmptyState tab={tab} />
      ) : isSortedBySubaccount && isOrgWide && groupedItems ? (
        /* Grouped by subaccount view */
        <div className="flex flex-col gap-1">
          {groupedItems.map((group) => (
            <div key={group.name}>
              <SubaccountGroupHeader name={group.name} />
              <div className="flex flex-col gap-2">
                {group.items.map((item) => renderItem(item, false))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Default flat list */
        <div className="flex flex-col gap-2">
          {items.map((item) => renderItem(item, isOrgWide))}
        </div>
      )}
    </div>
  );
}
