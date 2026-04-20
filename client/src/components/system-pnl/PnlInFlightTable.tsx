import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import api from '../../lib/api';
import { useSocketRoom } from '../../hooks/useSocket';
import type {
  InFlightEntry,
  InFlightRemoval,
  InFlightSnapshotResponse,
} from '../../../../shared/types/systemPnl';

// ---------------------------------------------------------------------------
// LLM In-Flight tracker — live view of every LLM call currently dispatched
// but not yet resolved. Spec tasks/llm-inflight-realtime-tracker-spec.md §6.
//
// Data flow:
//   1. Mount → fetch GET /api/admin/llm-pnl/in-flight (authoritative snapshot)
//   2. Join socket room `system:llm-inflight` — receive added/removed events
//   3. Merge live events into local state via the same monotonic guard the
//      server uses (stateVersion + startedAt), so a reorder can't resurrect
//      a removed entry
//   4. 100 ms socket-event buffer on mount / reconnect — prevents a flicker
//      where a remove arriving between "snapshot GET returned" and "React
//      rendered" makes a row appear and instantly disappear (spec §5).
//   5. Elapsed-time column ticks locally every 1s (not from server events)
// ---------------------------------------------------------------------------

const SOCKET_BUFFER_MS = 100;
// While the snapshot fetch is in flight we extend the buffer window —
// once the fetch resolves it drops back to SOCKET_BUFFER_MS. Deliberately
// more conservative than spec §5's 100 ms figure: if the snapshot fetch
// takes longer than 100 ms (cold start, under load), events arriving
// during the fetch would otherwise merge before the snapshot render and
// cause the flicker this buffer exists to prevent.
const FETCH_BUFFER_MS = 1_000;
const ADDED_EVENT = 'llm-inflight:added';
const REMOVED_EVENT = 'llm-inflight:removed';

// Mirror the server's state-machine guard on the client: once a
// runtimeKey has been removed, a subsequent late `added` event for the
// same runtimeKey must not resurrect it, even after the socket-dedup
// LRU (500 entries in useSocket.ts) has rotated that eventId out.
// Bounded at 256 to keep memory predictable.
const RECENTLY_REMOVED_MAX = 256;

// The registry key is a global room — useSocketRoom needs a non-null
// `roomId` to emit `join:system-llm-inflight`, so we pass a static token.
// The server handler ignores the argument.
const ROOM_TOKEN = 'system';

type Row = InFlightEntry & { _key: string };

interface LedgerLink {
  ledgerRowId:       string | null;
  ledgerCommittedAt: string | null;
  terminalStatus:    InFlightRemoval['terminalStatus'];
}

interface BufferedEvent {
  kind:     'added' | 'removed';
  runtimeKey: string;
  entry?:   InFlightEntry;
  removal?: InFlightRemoval;
}

export default function PnlInFlightTable() {
  const [entries, setEntries] = useState<Row[]>([]);
  const [recentlyLanded, setRecentlyLanded] = useState<Map<string, LedgerLink>>(new Map());
  const [capped, setCapped] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Elapsed-time tick — purely client-side so the server doesn't emit per-
  // second socket spam. 1 Hz matches the visible precision of the column.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Socket-event buffer. During the `bufferingUntil` window (snapshot GET
  // in-flight + SOCKET_BUFFER_MS after it lands), socket events are
  // queued instead of merged — then drained once rendering is caught up.
  const bufferingUntilRef = useRef<number>(Date.now() + SOCKET_BUFFER_MS);
  const bufferedEventsRef = useRef<BufferedEvent[]>([]);

  // Runtime keys we've already processed a `removed` event for. Prevents
  // a late `added` arriving after its eventId has rotated out of the
  // socket-dedup LRU from resurrecting a landed row.
  const recentlyRemovedRef = useRef<Set<string>>(new Set());
  const recentlyRemovedOrderRef = useRef<string[]>([]);
  const markRecentlyRemoved = useCallback((runtimeKey: string) => {
    const set = recentlyRemovedRef.current;
    const order = recentlyRemovedOrderRef.current;
    if (set.has(runtimeKey)) return;
    set.add(runtimeKey);
    order.push(runtimeKey);
    while (order.length > RECENTLY_REMOVED_MAX) {
      const oldest = order.shift();
      if (oldest !== undefined) set.delete(oldest);
    }
  }, []);

  const applyAddEntry = useCallback((entry: InFlightEntry) => {
    // Mirror the server's monotonic state-machine guard (spec §4.3): a
    // removed runtimeKey can never be resurrected by a late add, even if
    // it's dropped out of the entries array and the socket-dedup LRU.
    if (recentlyRemovedRef.current.has(entry.runtimeKey)) return;
    setEntries((prev) => {
      const existing = prev.find((r) => r.runtimeKey === entry.runtimeKey);
      if (existing) return prev;
      return [{ ...entry, _key: entry.runtimeKey }, ...prev];
    });
  }, []);

  const applyRemoveEntry = useCallback((removal: InFlightRemoval) => {
    markRecentlyRemoved(removal.runtimeKey);
    setEntries((prev) => prev.filter((r) => r.runtimeKey !== removal.runtimeKey));
    setRecentlyLanded((prev) => {
      const next = new Map(prev);
      next.set(removal.runtimeKey, {
        ledgerRowId:       removal.ledgerRowId,
        ledgerCommittedAt: removal.ledgerCommittedAt,
        terminalStatus:    removal.terminalStatus,
      });
      return next;
    });
    // Drop the landed entry from the "recently landed" map after a short
    // grace window so the UI doesn't keep a stale terminal status forever.
    window.setTimeout(() => {
      setRecentlyLanded((prev) => {
        const next = new Map(prev);
        next.delete(removal.runtimeKey);
        return next;
      });
    }, 10_000);
  }, [markRecentlyRemoved]);

  const drainBuffer = useCallback(() => {
    const pending = bufferedEventsRef.current;
    bufferedEventsRef.current = [];
    for (const evt of pending) {
      if (evt.kind === 'added' && evt.entry) applyAddEntry(evt.entry);
      if (evt.kind === 'removed' && evt.removal) applyRemoveEntry(evt.removal);
    }
  }, [applyAddEntry, applyRemoveEntry]);

  const fetchSnapshot = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Re-arm the buffering window — socket events arriving during the fetch
    // and for 100 ms after are queued, then drained in-order.
    bufferingUntilRef.current = Date.now() + FETCH_BUFFER_MS;
    try {
      const res = await api.get<InFlightSnapshotResponse>(
        '/api/admin/llm-pnl/in-flight',
      );
      const data = res.data;
      setEntries(data.entries.map((e) => ({ ...e, _key: e.runtimeKey })));
      setCapped(data.capped);
      setGeneratedAt(data.generatedAt);
    } catch (err: unknown) {
      const message = (err && typeof err === 'object' && 'message' in err)
        ? String((err as { message: unknown }).message)
        : 'Failed to load in-flight snapshot.';
      setError(message);
    } finally {
      setLoading(false);
      // Close the buffering window shortly after render catches up.
      bufferingUntilRef.current = Date.now() + SOCKET_BUFFER_MS;
      window.setTimeout(drainBuffer, SOCKET_BUFFER_MS + 10);
    }
  }, [drainBuffer]);

  useEffect(() => { fetchSnapshot(); }, [fetchSnapshot]);

  const onAdded = useCallback((payload: unknown) => {
    const entry = payload as InFlightEntry | undefined;
    if (!entry || !entry.runtimeKey) return;
    if (Date.now() < bufferingUntilRef.current) {
      bufferedEventsRef.current.push({ kind: 'added', runtimeKey: entry.runtimeKey, entry });
      return;
    }
    applyAddEntry(entry);
  }, [applyAddEntry]);

  const onRemoved = useCallback((payload: unknown) => {
    const removal = payload as InFlightRemoval | undefined;
    if (!removal || !removal.runtimeKey) return;
    if (Date.now() < bufferingUntilRef.current) {
      bufferedEventsRef.current.push({ kind: 'removed', runtimeKey: removal.runtimeKey, removal });
      return;
    }
    applyRemoveEntry(removal);
  }, [applyRemoveEntry]);

  useSocketRoom(
    'system-llm-inflight',
    ROOM_TOKEN,
    { [ADDED_EVENT]: onAdded, [REMOVED_EVENT]: onRemoved },
    fetchSnapshot,
  );

  const rows = useMemo(() => entries, [entries]);
  const recentlyLandedList = useMemo(
    () => Array.from(recentlyLanded.entries()).slice(0, 10),
    [recentlyLanded],
  );

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">In-flight LLM calls</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Every LLM call currently dispatched but not yet resolved. Real-time via WebSocket.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {capped && (
            <span
              className="text-xs px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800"
              title="More than 500 calls are in-flight. Snapshot is capped — narrow the window via the URL if needed."
            >
              Capped at 500
            </span>
          )}
          {generatedAt && (
            <div className="text-xs text-slate-400">
              Snapshot {new Date(generatedAt).toLocaleTimeString()}
            </div>
          )}
          <button
            onClick={fetchSnapshot}
            disabled={loading}
            className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={fetchSnapshot}
            className="text-xs px-2 py-1 border border-rose-300 rounded hover:bg-rose-100"
          >
            Retry
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-left">
            <tr>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">Provider / model</th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">Feature</th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">Source</th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">Call site</th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">Attempt</th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 text-right">Elapsed</th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                  No calls in flight.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const startedMs = Date.parse(row.startedAt);
              const elapsedMs = Math.max(0, now - startedMs);
              const deadlineMs = Date.parse(row.deadlineAt);
              // "past timeout — sweep pending" = elapsed exceeds provider
              // timeout but hasn't reached the sweep deadline yet (spec §5 /
              // §12 round 3 item 5). `row.timeoutMs` is the provider ceiling;
              // `deadlineBufferMs` is the extra grace before the sweep fires.
              const pastTimeout = elapsedMs > row.timeoutMs && now < deadlineMs;
              return (
                <tr key={row._key} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">{row.label}</td>
                  <td className="px-4 py-2 text-slate-600">{row.featureTag}</td>
                  <td className="px-4 py-2 text-slate-600">
                    <div className="text-xs">{row.sourceType}</div>
                    {row.organisationId && (
                      <div className="text-[10px] text-slate-400 font-mono">{row.organisationId.slice(0, 8)}</div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-block text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                      row.callSite === 'worker'
                        ? 'bg-violet-50 text-violet-700 border border-violet-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}>
                      {row.callSite}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">#{row.attempt}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
                    {formatElapsed(elapsedMs)}
                  </td>
                  <td className="px-4 py-2">
                    {pastTimeout ? (
                      <span
                        className="inline-block text-[11px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800"
                        title="Provider timeoutMs has passed but the deadline-based sweep hasn't fired yet. The router would have aborted this call — the entry will be reaped within the deadline buffer."
                      >
                        past timeout — sweep pending
                      </span>
                    ) : (
                      <span className="inline-block text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700">
                        in flight
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {recentlyLandedList.length > 0 && (
        <div className="mt-3 text-xs text-slate-400">
          Recently landed:{' '}
          {recentlyLandedList.map(([key, link], i) => (
            <span key={key} className="mr-3 inline-block">
              {link.terminalStatus}
              {link.ledgerRowId && (
                <a
                  href={`#call-${link.ledgerRowId}`}
                  className="ml-1 text-indigo-600 hover:underline"
                >
                  [ledger]
                </a>
              )}
              {i < recentlyLandedList.length - 1 && ','}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${minutes}m ${s}s`;
}
