// Live Agent Execution Log — per-run page.
// Spec: tasks/live-agent-execution-log-spec.md §6.5.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import { useSocketRoom } from '../hooks/useSocket';
import Timeline from '../components/agentRunLog/Timeline';
import EventDetailDrawer from '../components/agentRunLog/EventDetailDrawer';
import AgentRunCancelButton from '../components/AgentRunCancelButton';
import { formatDuration } from '../lib/formatDuration';
import type {
  AgentExecutionEvent,
  AgentExecutionEventPage,
} from '../../../shared/types/agentExecutionLog';

type RunMeta = {
  agentName: string;
  status: string;
  durationMs: number | null;
  eventCount: number | null;
  startedAt: string | null;
};

const INITIAL_FETCH_LIMIT = 1000;
const BACKFILL_LIMIT = 1000;
// Sliding-window cap on events held in client state. Prevents memory + render
// cost from runs that approach the server-side 10k-event cap. The timeline
// trims to the most-recent TIMELINE_WINDOW_SIZE events whenever merge exceeds
// it; the snapshot endpoint remains the authoritative historical record.
const TIMELINE_WINDOW_SIZE = 2000;

// Process-local client metrics for the live log. Complements the per-drop
// console.warn lines with aggregate counters so an operator can eyeball
// "how often are we seeing gaps / collisions right now?" without
// tail-following the console. Exposed via `getAgentRunLiveClientMetrics()`
// for a future admin page or manual inspection via window.* hook.
const clientMetrics = {
  sequenceGapsTotal: 0,
  sequenceCollisionsTotal: 0,
};

export function getAgentRunLiveClientMetrics(): {
  sequenceGapsTotal: number;
  sequenceCollisionsTotal: number;
} {
  return { ...clientMetrics };
}

const STATUS_BADGE: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  running: 'bg-blue-100 text-blue-700',
  cancelling: 'bg-slate-200 text-slate-700',
  cancelled: 'bg-slate-100 text-slate-600',
};

export default function AgentRunLivePage({ user: _user }: { user: User }) {
  const { runId } = useParams<{ runId: string }>();
  const [events, setEvents] = useState<AgentExecutionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AgentExecutionEvent | null>(null);
  const [runMeta, setRunMeta] = useState<RunMeta | null>(null);
  const lastSeenSeqRef = useRef(0);
  const initialBufferRef = useRef<AgentExecutionEvent[]>([]);
  const initialGateRef = useRef(false);

  // ── Initial snapshot fetch ───────────────────────────────────────────────
  const fetchSnapshot = useCallback(async (fromSeq: number) => {
    if (!runId) return;
    let cursor = fromSeq;
    let keepGoing = true;
    while (keepGoing) {
      const { data } = await api.get(`/api/agent-runs/${runId}/events`, {
        params: { fromSeq: cursor, limit: INITIAL_FETCH_LIMIT },
      });
      const page = (data?.data ?? null) as AgentExecutionEventPage | null;
      if (!page) break;
      if (page.events.length > 0) {
        setEvents((prev) => mergeEvents(prev, page.events));
        lastSeenSeqRef.current = Math.max(
          lastSeenSeqRef.current,
          page.highestSequenceNumber,
        );
        cursor = page.highestSequenceNumber + 1;
      }
      keepGoing = page.hasMore;
    }
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    // Reset all per-run state so events from a previous run (e.g. navigating
    // from /runs/A/live to /runs/B/live in the same SPA session) don't bleed
    // into the new run's timeline.
    setEvents([]);
    setSelected(null);
    setRunMeta(null);
    lastSeenSeqRef.current = 0;
    initialBufferRef.current = [];
    initialGateRef.current = false;
    setLoading(true);
    setError(null);

    api.get(`/api/agent-runs/${runId}`).then(({ data }) => {
      setRunMeta({
        agentName: data.agentName ?? '',
        status: data.status ?? '',
        durationMs: data.durationMs ?? null,
        eventCount: data.eventCount ?? null,
        startedAt: data.startedAt ?? null,
      });
    }).catch(() => {/* meta bar is best-effort */});

    fetchSnapshot(1)
      .then(() => setLoading(false))
      .catch((err) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        setError(status === 403 ? 'You do not have permission to view this run.' : 'Failed to load events.');
        setLoading(false);
      })
      .finally(() => {
        // Drain the live buffer that accumulated while the snapshot was
        // loading. Merge with dedup so snapshot + live never collide.
        initialGateRef.current = true;
        if (initialBufferRef.current.length > 0) {
          setEvents((prev) => mergeEvents(prev, initialBufferRef.current));
          initialBufferRef.current = [];
        }
      });
  }, [runId, fetchSnapshot]);

  // ── Live socket subscription ─────────────────────────────────────────────
  useSocketRoom(
    'agent-run',
    runId ?? null,
    {
      'agent:run:cancelling': (payload: unknown) => {
        const p = payload as { runId?: string } | null;
        if (p?.runId !== runId) return;
        setRunMeta((prev) => prev ? { ...prev, status: 'cancelling' } : prev);
      },
      'agent-run:execution-event': (payload: unknown) => {
        const event = payload as AgentExecutionEvent;
        if (!event || typeof event !== 'object' || !('sequenceNumber' in event)) return;
        // Mount buffer — holds live socket events until the initial
        // snapshot fetch completes and the buffer is drained. NOTE: the
        // snapshot/live ordering correctness does NOT rely on this
        // buffer's timing — it relies on the monotonic `sequenceNumber
        // <= lastSeenSeqRef.current` guard below, which drops any
        // already-covered event regardless of arrival order. The buffer
        // only exists to avoid re-render churn during the initial load;
        // if a refactor removes it, the guard still holds correctness.
        if (!initialGateRef.current) {
          initialBufferRef.current.push(event);
          return;
        }
        // Monotonic guard: drop duplicates + out-of-order arrivals the
        // snapshot has already covered. Defensive against future id /
        // sequencing changes; safe because the snapshot backfill on
        // reconnect always raises lastSeenSeq.
        if (event.sequenceNumber <= lastSeenSeqRef.current) return;
        // Gap-detection warning — a jump beyond the expected next
        // sequence is legal (the spec tolerates gaps caused by non-
        // critical-event cap-drops and transaction rollbacks), but
        // surface them so operators can correlate missing events with
        // cap-drop metrics. One-line signal; no runtime guard.
        if (
          lastSeenSeqRef.current > 0 &&
          event.sequenceNumber > lastSeenSeqRef.current + 1
        ) {
          clientMetrics.sequenceGapsTotal += 1;
          // eslint-disable-next-line no-console
          console.warn('AgentRunLivePage: sequence gap', {
            lastSeen: lastSeenSeqRef.current,
            received: event.sequenceNumber,
            gap: event.sequenceNumber - lastSeenSeqRef.current - 1,
            runId: event.runId,
          });
        }
        setEvents((prev) => mergeEvents(prev, [event]));
        lastSeenSeqRef.current = event.sequenceNumber;
      },
    },
    useCallback(() => {
      // Reconnect resync — fetch everything since our highest seen seq.
      void fetchSnapshot(lastSeenSeqRef.current + 1);
    }, [fetchSnapshot]),
  );

  if (!runId) return <div className="p-6 text-slate-600">Missing run id.</div>;

  // Cap-reached banner — the server emits exactly one
  // `run.event_limit_reached` event when a run exceeds
  // AGENT_EXECUTION_LOG_MAX_EVENTS_PER_RUN. When it's in the timeline,
  // surface a visible banner so operators know why the timeline may
  // look truncated (critical lifecycle events still emit; non-critical
  // events after the cap are dropped).
  const capEvent = events.find((e) => e.eventType === 'run.event_limit_reached');
  const capDetails =
    capEvent && capEvent.payload && 'cap' in capEvent.payload
      ? (capEvent.payload as { eventCountAtLimit?: number; cap?: number })
      : null;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center mb-4">
        <h1 className="text-lg font-semibold text-slate-900">Live execution log</h1>
        <div className="ml-auto flex items-center gap-3">
          {runId && runMeta && (
            <AgentRunCancelButton
              runId={runId}
              status={runMeta.status}
              onCancelled={() => {
                // Optimistic — websocket / next snapshot will reconcile.
                setRunMeta((prev) => prev ? { ...prev, status: 'cancelling' } : prev);
              }}
            />
          )}
          <Link
            to={`/admin/runs/${runId}`}
            className="text-sm text-indigo-600 hover:underline"
          >
            View run trace →
          </Link>
        </div>
      </div>
      {runMeta ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-[12px] text-slate-600">
          <span className="font-semibold text-slate-800">{runMeta.agentName}</span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${STATUS_BADGE[runMeta.status] ?? 'bg-slate-100 text-slate-600'}`}>
            {runMeta.status}
          </span>
          <span>{formatDuration(runMeta.durationMs)}</span>
          {runMeta.eventCount != null && <span>{runMeta.eventCount.toLocaleString()} events</span>}
          {runMeta.startedAt && (
            <span>Started {new Date(runMeta.startedAt).toLocaleString()}</span>
          )}
        </div>
      ) : (
        <div className="text-xs text-slate-500 mb-3 font-mono">Run {runId}</div>
      )}

      {capDetails && (
        <div
          role="status"
          className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-start gap-3"
        >
          <div className="flex-1">
            <strong>Event cap reached.</strong>{' '}
            This run exceeded {capDetails.cap ?? 'the configured'} events at sequence #
            {capDetails.eventCountAtLimit ?? '?'}. Critical lifecycle + LLM events continued
            to emit; non-critical events after this point were dropped to preserve
            observability headroom.
          </div>
          <Link
            to={`/admin/runs/${runId}`}
            className="text-amber-900 underline whitespace-nowrap hover:text-amber-700"
          >
            View run trace →
          </Link>
        </div>
      )}

      {loading && <div className="text-sm text-slate-500 p-6 text-center">Loading…</div>}
      {error && <div className="text-sm text-rose-700 bg-rose-50 rounded p-3">{error}</div>}
      {!loading && !error && <Timeline events={events} onOpen={setSelected} />}

      <EventDetailDrawer
        event={selected}
        runId={runId}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

// Merge two event lists by `id`, preserving ascending `sequenceNumber` order.
//
// Monotonic-sequence invariant: events with the same sequenceNumber but
// different ids (should never happen — the sequence is per-run unique)
// fall through the id-keyed Map and the last-writer wins. The Map by id
// handles the normal case — snapshot and socket emit the same row with
// the same id, and dedup picks one copy. If a future change alters id
// generation, this function remains safe because sequenceNumber is the
// sort key.
//
// Sequence-collision detector: logs a warning when two distinct ids share
// a sequenceNumber in the merged output. Not a runtime guard — pure
// visibility for upstream bugs (emitter double-writing, rebase-race on
// the atomic-UPDATE allocator, etc.). No-op in production when clean.
//
// After merge, the returned list is trimmed to TIMELINE_WINDOW_SIZE
// most-recent entries — the snapshot endpoint is still the full history.
function mergeEvents(
  existing: AgentExecutionEvent[],
  incoming: AgentExecutionEvent[],
): AgentExecutionEvent[] {
  if (incoming.length === 0) return existing;
  const byId = new Map<string, AgentExecutionEvent>();
  for (const e of existing) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e);
  const merged = Array.from(byId.values()).sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber,
  );

  // Sequence-collision warning + metric — distinct ids sharing a
  // sequenceNumber indicate an upstream invariant break. Scan after sort
  // so adjacent collisions are cheap to detect. The counter complements
  // the console.warn so operators can check aggregate health.
  for (let i = 1; i < merged.length; i++) {
    if (merged[i - 1].sequenceNumber === merged[i].sequenceNumber) {
      clientMetrics.sequenceCollisionsTotal += 1;
      // eslint-disable-next-line no-console
      console.warn('AgentRunLivePage.mergeEvents: sequence collision', {
        sequenceNumber: merged[i].sequenceNumber,
        ids: [merged[i - 1].id, merged[i].id],
        runId: merged[i].runId,
      });
    }
  }

  if (merged.length <= TIMELINE_WINDOW_SIZE) return merged;
  return merged.slice(merged.length - TIMELINE_WINDOW_SIZE);
}
