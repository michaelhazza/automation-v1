// Live Agent Execution Log — per-run page.
// Spec: tasks/live-agent-execution-log-spec.md §6.5.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import { useSocketRoom } from '../hooks/useSocket';
import Timeline from '../components/agentRunLog/Timeline';
import EventDetailDrawer from '../components/agentRunLog/EventDetailDrawer';
import type {
  AgentExecutionEvent,
  AgentExecutionEventPage,
} from '../../../shared/types/agentExecutionLog';

const INITIAL_FETCH_LIMIT = 1000;
const BACKFILL_LIMIT = 1000;

export default function AgentRunLivePage({ user: _user }: { user: User }) {
  const { runId } = useParams<{ runId: string }>();
  const [events, setEvents] = useState<AgentExecutionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AgentExecutionEvent | null>(null);
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
    setLoading(true);
    setError(null);
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
      'agent-run:execution-event': (payload: unknown) => {
        const event = payload as AgentExecutionEvent;
        if (!event || typeof event !== 'object' || !('sequenceNumber' in event)) return;
        // 100 ms buffer on mount — prevents snapshot/live collisions.
        if (!initialGateRef.current) {
          initialBufferRef.current.push(event);
          return;
        }
        setEvents((prev) => mergeEvents(prev, [event]));
        lastSeenSeqRef.current = Math.max(lastSeenSeqRef.current, event.sequenceNumber);
      },
    },
    useCallback(() => {
      // Reconnect resync — fetch everything since our highest seen seq.
      void fetchSnapshot(lastSeenSeqRef.current + 1);
    }, [fetchSnapshot]),
  );

  if (!runId) return <div className="p-6 text-slate-600">Missing run id.</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center mb-4">
        <h1 className="text-lg font-semibold text-slate-900">Live execution log</h1>
        <Link
          to={`/admin/runs/${runId}`}
          className="ml-auto text-sm text-indigo-600 hover:underline"
        >
          View run trace →
        </Link>
      </div>
      <div className="text-xs text-slate-500 mb-3 font-mono">Run {runId}</div>

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
function mergeEvents(
  existing: AgentExecutionEvent[],
  incoming: AgentExecutionEvent[],
): AgentExecutionEvent[] {
  if (incoming.length === 0) return existing;
  const byId = new Map<string, AgentExecutionEvent>();
  for (const e of existing) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e);
  return Array.from(byId.values()).sort((a, b) => a.sequenceNumber - b.sequenceNumber);
}
