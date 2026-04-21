import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import api from '../../lib/api';
import { useSocketRoom } from '../../hooks/useSocket';
import PnlInFlightPayloadDrawer from './PnlInFlightPayloadDrawer';
import type {
  InFlightEntry,
  InFlightProgress,
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
const ADDED_EVENT = 'llm-inflight:added';
const REMOVED_EVENT = 'llm-inflight:removed';
const PROGRESS_EVENT = 'llm-inflight:progress';

// Mirror the server's state-machine guard on the client: once a
// runtimeKey has been removed, a subsequent late `added` event for the
// same runtimeKey must not resurrect it, even after the socket-dedup
// LRU (500 entries in useSocket.ts) has rotated that eventId out.
// Bounded at 256 to keep memory predictable.
const RECENTLY_REMOVED_MAX = 256;

// Bound on the stateVersion map — mirrors the RECENTLY_REMOVED set size
// so the monotonic guarantee and the resurrection guard have matching
// memory footprints. A runtimeKey whose version has rolled out of this
// map is also well past the 30s server-side retention window, so a
// straggling add could only surface a stale call whose entry has been
// long since pruned — the entries-array presence check below catches
// that separately.
const STATE_VERSION_MAP_MAX = 256;

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

interface Props {
  /** Called when the user clicks a landed ledger link. Wired to the
   * parent page's setSelectedCallId so the call-detail drawer opens. */
  onOpenDetail?: (ledgerRowId: string) => void;
}

export default function PnlInFlightTable({ onOpenDetail }: Props = {}) {
  const [entries, setEntries] = useState<Row[]>([]);
  const [recentlyLanded, setRecentlyLanded] = useState<Map<string, LedgerLink>>(new Map());
  // Per-runtimeKey streaming progress — transient, cleared on remove. Drawn
  // from `llm-inflight:progress` events (deferred-items brief §5). Stored
  // separately from `entries` so a progress update doesn't force a
  // re-render of the entire table.
  const [progress, setProgress] = useState<Map<string, InFlightProgress>>(new Map());
  // Open live-payload drawer (deferred-items brief §7). `null` = closed.
  const [payloadDrawerEntry, setPayloadDrawerEntry] = useState<InFlightEntry | null>(null);
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

  // Highest stateVersion observed per runtimeKey — the client-side
  // counterpart to the server's monotonic guard (see `applyIncomingEvent`
  // in llmInflightRegistryPure.ts). The server already refuses to emit
  // a lower-version event for a given (runtimeKey, startedAt) tuple, so
  // this guard is a belt-and-braces backstop against any reorder or
  // replay that slips through socket-layer dedup. It also closes the
  // race from pr-review feedback: a delayed `add` arriving after its
  // `remove` has aged out of the bounded `recentlyRemovedRef` set would
  // otherwise resurrect the row — the stateVersion comparison rejects
  // it because a `remove` always stamps version 2, and any subsequent
  // `add` carrying version 1 is strictly lower.
  const stateVersionByKeyRef = useRef<Map<string, 1 | 2>>(new Map());
  const stateVersionOrderRef = useRef<string[]>([]);
  const recordStateVersion = useCallback(
    (runtimeKey: string, version: 1 | 2): boolean => {
      const map = stateVersionByKeyRef.current;
      const order = stateVersionOrderRef.current;
      const known = map.get(runtimeKey);
      // Reject non-monotonic transitions (incoming <= known). The server
      // enforces this at emission time, so we only see this when a stale
      // replay leaks through.
      if (known !== undefined && version <= known) {
        return false;
      }
      map.set(runtimeKey, version);
      if (known === undefined) {
        order.push(runtimeKey);
        while (order.length > STATE_VERSION_MAP_MAX) {
          const oldest = order.shift();
          if (oldest !== undefined) map.delete(oldest);
        }
      }
      return true;
    },
    [],
  );

  const applyAddEntry = useCallback((entry: InFlightEntry) => {
    // Mirror the server's monotonic state-machine guard (spec §4.3): a
    // removed runtimeKey can never be resurrected by a late add, even if
    // it's dropped out of the entries array and the socket-dedup LRU.
    //
    // Two defences in depth:
    //   1. `recentlyRemovedRef` — bounded-set "I've seen a remove for this
    //      runtimeKey" check; rejects adds after aged-out remove events.
    //   2. `stateVersionByKeyRef` — strict monotonic check against the
    //      server's stateVersion contract (1=active, 2=removed). A v1
    //      add arriving after a v2 remove has already won is always
    //      rejected here.
    if (recentlyRemovedRef.current.has(entry.runtimeKey)) return;
    if (!recordStateVersion(entry.runtimeKey, entry.stateVersion)) return;
    setEntries((prev) => {
      const existing = prev.find((r) => r.runtimeKey === entry.runtimeKey);
      if (existing) return prev;
      return [{ ...entry, _key: entry.runtimeKey }, ...prev];
    });
  }, [recordStateVersion]);

  const applyRemoveEntry = useCallback((removal: InFlightRemoval) => {
    // Stamp version=2 (no-op if already 2 — the map stays consistent) and
    // always apply the merge below. We intentionally DON'T gate this on
    // `recordStateVersion`'s return value because the router emits a
    // second remove event ("ledger-link rehydration") for the same
    // runtimeKey when a retryable-error-removed entry later gets its
    // ledger row written: both events carry stateVersion=2 but the
    // second one has `ledgerRowId` populated. The merge below overwrites
    // the earlier null ledger entry so the UI's [ledger] button appears.
    // The `setEntries(prev.filter(...))` call is idempotent — filtering
    // an already-filtered array is a cheap no-op.
    recordStateVersion(removal.runtimeKey, removal.stateVersion);
    markRecentlyRemoved(removal.runtimeKey);
    setEntries((prev) => prev.filter((r) => r.runtimeKey !== removal.runtimeKey));
    // Drop the streaming progress for this runtimeKey — tokensOut on the
    // removal event is now the authoritative source.
    setProgress((prev) => {
      if (!prev.has(removal.runtimeKey)) return prev;
      const next = new Map(prev);
      next.delete(removal.runtimeKey);
      return next;
    });
    setRecentlyLanded((prev) => {
      const next = new Map(prev);
      const existing = prev.get(removal.runtimeKey);
      // Preserve a previously-populated ledgerRowId if the rehydration
      // event happens to carry null (e.g. a stray replay after the real
      // link was already delivered). "Once linked, stay linked."
      next.set(removal.runtimeKey, {
        ledgerRowId:       removal.ledgerRowId ?? existing?.ledgerRowId ?? null,
        ledgerCommittedAt: removal.ledgerCommittedAt ?? existing?.ledgerCommittedAt ?? null,
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
  }, [markRecentlyRemoved, recordStateVersion]);

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
    // Hold the buffer open for the full lifetime of the GET so socket events
    // that arrive while the request is in-flight are queued rather than merged
    // prematurely. Setting to MAX_SAFE_INTEGER and then resetting in `finally`
    // ensures the window stays open regardless of how long the fetch takes.
    bufferingUntilRef.current = Number.MAX_SAFE_INTEGER;
    try {
      const res = await api.get<InFlightSnapshotResponse>(
        '/api/admin/llm-pnl/in-flight',
      );
      const data = res.data;
      // Seed the stateVersion map with version=1 for every snapshot row so
      // a subsequent duplicate `added` event for the same runtimeKey is
      // rejected as non-monotonic. Without this, the post-fetch drain of
      // the buffered `added` events would re-insert rows already present
      // in the snapshot.
      for (const e of data.entries) {
        recordStateVersion(e.runtimeKey, 1);
      }
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
      // Close the buffering window shortly after render catches up, then drain
      // any events that arrived while the snapshot was in-flight.
      bufferingUntilRef.current = Date.now() + SOCKET_BUFFER_MS;
      window.setTimeout(drainBuffer, SOCKET_BUFFER_MS + 10);
    }
  }, [drainBuffer, recordStateVersion]);

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

  const onProgress = useCallback((envelope: unknown) => {
    // Progress events come wrapped in the standard InFlightEventEnvelope —
    // the payload is the InFlightProgress. No buffering: progress is
    // purely advisory; dropping an event is fine.
    const env = envelope as { payload?: InFlightProgress } | undefined;
    const prog = env?.payload;
    if (!prog || !prog.runtimeKey) return;
    setProgress((prev) => {
      const next = new Map(prev);
      next.set(prog.runtimeKey, prog);
      return next;
    });
  }, []);

  useSocketRoom(
    'system-llm-inflight',
    ROOM_TOKEN,
    { [ADDED_EVENT]: onAdded, [REMOVED_EVENT]: onRemoved, [PROGRESS_EVENT]: onProgress },
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

      {/* Desktop table — hidden below md breakpoint. Mobile card view lives
          directly below (deferred-items brief §8). Both share the same row
          data; only the rendering differs. */}
      <div className="hidden md:block bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-left">
            <tr>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">Provider / model</th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">Feature</th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">Source</th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">Call site</th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">Attempt</th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 text-right">Queued</th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 text-right">Elapsed</th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">
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
              // Deferred-items brief §4: show the monotonic sequence when a
              // fallback has happened, otherwise the per-provider counter.
              const attemptLabel = row.attemptSequence !== row.attempt
                ? `#${row.attemptSequence}`
                : `#${row.attempt}`;
              // Brief §3: colour-code the dispatch-delay cell so a budget
              // lock wait or cooldown bounce is visible at a glance.
              // Thresholds: >1s amber, >5s red.
              const delayClass = row.dispatchDelayMs > 5_000
                ? 'text-rose-600'
                : row.dispatchDelayMs > 1_000
                  ? 'text-amber-700'
                  : 'text-slate-500';
              // Brief §5: surface streaming token progress on the Elapsed
              // cell when available. The authoritative tokensOut still
              // arrives on the removal event; this is purely a UX signal.
              const prog = progress.get(row.runtimeKey);
              return (
                <tr
                  key={row._key}
                  onClick={() => setPayloadDrawerEntry(row)}
                  className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                  title="Click for live payload"
                >
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
                  <td
                    className="px-4 py-2 text-slate-600"
                    title={
                      row.attemptSequence !== row.attempt
                        ? `Attempt #${row.attemptSequence} of the logical call (provider attempt #${row.attempt}, fallback index ${row.fallbackIndex})`
                        : `Attempt #${row.attempt}`
                    }
                  >
                    {attemptLabel}
                    {row.fallbackIndex > 0 && (
                      <span className="ml-1 text-[10px] text-slate-400">
                        ↳fb#{row.fallbackIndex}
                      </span>
                    )}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-mono text-xs ${delayClass}`}
                    title={`${row.dispatchDelayMs}ms between routeCall entry and provider dispatch`}
                  >
                    {formatElapsed(row.dispatchDelayMs)}
                  </td>
                  <td
                    className="px-4 py-2 text-right font-mono text-xs text-slate-700"
                    title={prog ? `${prog.tokensSoFar} tokens generated so far (advisory)` : undefined}
                  >
                    {formatElapsed(elapsedMs)}
                    {prog && (
                      <span className="ml-1 text-[10px] text-indigo-500">
                        · {prog.tokensSoFar}t
                      </span>
                    )}
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

      {/* Mobile card view — shown below the md breakpoint. Same data, card
          layout so each row is readable on a narrow viewport without
          horizontal scrolling. Deferred-items brief §8. */}
      <div className="md:hidden space-y-2">
        {rows.length === 0 && !loading && (
          <div className="bg-white border border-slate-200 rounded-lg py-8 text-center text-sm text-slate-400">
            No calls in flight.
          </div>
        )}
        {rows.map((row) => {
          const startedMs = Date.parse(row.startedAt);
          const elapsedMs = Math.max(0, now - startedMs);
          const deadlineMs = Date.parse(row.deadlineAt);
          const pastTimeout = elapsedMs > row.timeoutMs && now < deadlineMs;
          const attemptLabel = row.attemptSequence !== row.attempt
            ? `#${row.attemptSequence}`
            : `#${row.attempt}`;
          const delayClass = row.dispatchDelayMs > 5_000
            ? 'text-rose-600'
            : row.dispatchDelayMs > 1_000
              ? 'text-amber-700'
              : 'text-slate-500';
          // Brief §5 + pr-review finding #5: the mobile card must surface
          // the same streaming token counter as the desktop table —
          // otherwise admins on mobile silently lose the "is the stream
          // making progress" signal when streaming lands.
          const mobileProg = progress.get(row.runtimeKey);
          return (
            <div
              key={`mobile-${row._key}`}
              onClick={() => setPayloadDrawerEntry(row)}
              role="button"
              className="bg-white border border-slate-200 rounded-lg p-3 cursor-pointer active:bg-slate-50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-mono text-xs text-slate-700 break-all">{row.label}</div>
                {pastTimeout ? (
                  <span
                    className="shrink-0 inline-block text-[10px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800"
                    title="Provider timeoutMs has passed but the deadline-based sweep hasn't fired yet."
                  >
                    sweep pending
                  </span>
                ) : (
                  <span className="shrink-0 inline-block text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700">
                    in flight
                  </span>
                )}
              </div>
              <div className="mt-2 text-xs text-slate-500">
                <span className="text-slate-700">{row.featureTag}</span>
                <span className="mx-1.5 text-slate-300">·</span>
                {row.sourceType}
                {row.organisationId && (
                  <span className="ml-1 font-mono text-[10px] text-slate-400">
                    {row.organisationId.slice(0, 8)}
                  </span>
                )}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Attempt</div>
                  <div className="text-slate-700">
                    {attemptLabel}
                    {row.fallbackIndex > 0 && (
                      <span className="ml-1 text-[10px] text-slate-400">↳fb#{row.fallbackIndex}</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Queued</div>
                  <div className={`font-mono ${delayClass}`}>
                    {formatElapsed(row.dispatchDelayMs)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Elapsed</div>
                  <div
                    className="font-mono text-slate-700"
                    title={mobileProg ? `${mobileProg.tokensSoFar} tokens generated so far (advisory)` : undefined}
                  >
                    {formatElapsed(elapsedMs)}
                    {mobileProg && (
                      <span className="ml-1 text-[10px] text-indigo-500">· {mobileProg.tokensSoFar}t</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className={`inline-block text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  row.callSite === 'worker'
                    ? 'bg-violet-50 text-violet-700 border border-violet-200'
                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                }`}>
                  {row.callSite}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {recentlyLandedList.length > 0 && (
        <div className="mt-3 text-xs text-slate-400">
          Recently landed:{' '}
          {recentlyLandedList.map(([key, link], i) => (
            <span key={key} className="mr-3 inline-block">
              {link.terminalStatus}
              {link.ledgerRowId && onOpenDetail && (
                <button
                  type="button"
                  onClick={() => onOpenDetail(link.ledgerRowId!)}
                  className="ml-1 text-indigo-600 hover:underline"
                >
                  [ledger]
                </button>
              )}
              {i < recentlyLandedList.length - 1 && ','}
            </span>
          ))}
        </div>
      )}

      <PnlInFlightPayloadDrawer
        entry={payloadDrawerEntry}
        onClose={() => setPayloadDrawerEntry(null)}
      />
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
