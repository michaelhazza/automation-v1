/**
 * ClientPulseClientsListPage.tsx
 *
 * Full client list with band filter chips and search.
 * Route: /clientpulse/clients (wired in Task 6.2)
 * Spec: ClientPulse UI simplification §6.3
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import NeedsAttentionRow from '../components/clientpulse/NeedsAttentionRow';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientRow {
  subaccountId: string;
  subaccountName: string;
  healthScore: number;
  healthBand: 'critical' | 'at_risk' | 'watch' | 'healthy';
  healthScoreDelta7d: number;
  sparklineWeekly: number[];
  lastActionText: string | null;
  hasPendingIntervention: boolean;
  drilldownUrl: string;
}

interface HighRiskClientsResponse {
  clients: ClientRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BANDS = [
  { label: 'All', value: 'all' },
  { label: 'Critical', value: 'critical' },
  { label: 'At Risk', value: 'at_risk' },
  { label: 'Watch', value: 'watch' },
  { label: 'Healthy', value: 'healthy' },
];

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="h-16 rounded-lg bg-slate-100 animate-pulse" />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientPulseClientsListPage({ user: _user }: { user: User }): JSX.Element {
  // ── State ──────────────────────────────────────────────────────────────────
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // ── Filters ────────────────────────────────────────────────────────────────
  const [band, setBand] = useState<string>('all');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  // Debounce q → debouncedQ
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // ── Fetch helper (stable ref per band + debouncedQ) ────────────────────────
  const fetchPage = useCallback(async (cursor: string | undefined): Promise<HighRiskClientsResponse | null> => {
    try {
      const params: Record<string, string> = { limit: '25', band };
      if (debouncedQ) params.q = debouncedQ;
      if (cursor) params.cursor = cursor;
      const res = await api.get('/api/clientpulse/high-risk', { params });
      return res.data as HighRiskClientsResponse;
    } catch (err) {
      console.error('[ClientPulseClientsListPage] fetch failed', err);
      return null;
    }
  }, [band, debouncedQ]);

  // ── Re-fetch from scratch when band or debouncedQ change ──────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setClients([]);
    setHasMore(false);
    setNextCursor(null);

    fetchPage(undefined).then((data) => {
      if (cancelled) return;
      if (data) {
        setClients(data.clients);
        setHasMore(data.hasMore);
        setNextCursor(data.nextCursor);
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [band, debouncedQ, fetchPage]);

  // ── Load more ──────────────────────────────────────────────────────────────
  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const data = await fetchPage(nextCursor);
    if (data) {
      setClients((prev) => [...prev, ...data.clients]);
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
    }
    setLoadingMore(false);
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const filtersActive = band !== 'all' || debouncedQ.trim() !== '';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {/* Back link */}
      <Link
        to="/clientpulse"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 transition-colors no-underline"
      >
        <span aria-hidden="true">←</span> Back to ClientPulse
      </Link>

      {/* Header row: title + search */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Clients</h1>
        <input
          type="search"
          placeholder="Search clients…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-64 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>

      {/* Band filter chips */}
      <div className="flex flex-wrap gap-2">
        {BANDS.map((b) => (
          <button
            key={b.value}
            type="button"
            onClick={() => setBand(b.value)}
            className={
              band === b.value
                ? 'px-3 py-1 rounded-full text-sm font-medium bg-indigo-600 text-white'
                : 'px-3 py-1 rounded-full text-sm font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors'
            }
          >
            {b.label}
          </button>
        ))}
      </div>

      {/* Client list */}
      <div className="rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100 bg-white">
        {loading ? (
          // First-load skeleton
          <div className="p-3 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : clients.length === 0 ? (
          // Empty state
          <div className="py-16 text-center text-slate-400 text-sm">
            {filtersActive
              ? 'No clients match your filters.'
              : 'No clients yet.'}
          </div>
        ) : (
          clients.map((c) => (
            <NeedsAttentionRow key={c.subaccountId} client={c} />
          ))
        )}
      </div>

      {/* Load more */}
      {!loading && hasMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="px-5 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
