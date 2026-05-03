/**
 * useTaskEventStream — React hook for real-time task execution events.
 *
 * Joins the `task:${taskId}` Socket.IO room, subscribes to
 * `task:execution-event`, applies events in (taskSequence, eventSubsequence)
 * order with a 1-second buffer for out-of-order arrival.
 *
 * On reconnect: fetches missed events via the replay endpoint.
 * Periodic re-fetch every 60 seconds while the page is visible (delta-only).
 * On `task.degraded` event: triggers immediate replay.
 *
 * Spec: docs/workflows-dev-spec.md §8 client ordering invariant.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { getSocket, onReconnect } from '../lib/socket';
import api from '../lib/api';
import type { TaskEvent, TaskEventEnvelope } from '../../../shared/types/taskEvent';
import {
  mergeEventsByCursor,
  detectGap,
  getCursor,
} from './useTaskEventStreamPure';

// ─── Hook result shape ────────────────────────────────────────────────────────

export interface UseTaskEventStreamResult {
  events: TaskEvent[];
  degraded: boolean;
  gap: boolean;
}

// ─── Dedup cache (shared across hook instances — same LRU used by useSocket) ──

const DEDUP_MAX = 1000;
const seenEventIds = new Set<string>();
const seenEventOrder: string[] = [];

function markSeen(eventId: string): boolean {
  if (seenEventIds.has(eventId)) return true;
  seenEventIds.add(eventId);
  seenEventOrder.push(eventId);
  while (seenEventOrder.length > DEDUP_MAX) {
    const oldest = seenEventOrder.shift()!;
    seenEventIds.delete(oldest);
  }
  return false;
}

// ─── Replay fetch ─────────────────────────────────────────────────────────────

interface ReplayResponse {
  events: TaskEventEnvelope[];
  hasGap: boolean;
  oldestRetainedSeq: number;
  /** When non-null, more pages exist; the client should fetch again from this cursor. */
  nextCursor: { fromSeq: number; fromSubseq: number } | null;
}

async function fetchReplayPage(
  taskId: string,
  fromSeq: number,
  fromSubseq: number,
): Promise<ReplayResponse> {
  const { data } = await api.get<ReplayResponse>(
    `/api/tasks/${taskId}/event-stream/replay`,
    { params: { fromSeq, fromSubseq } },
  );
  return data;
}

/**
 * Fetch all pages from the replay endpoint, following nextCursor until null.
 * Returns the merged event set, hasGap flag, and oldestRetainedSeq.
 *
 * Safety: each page is LIMIT 1000 on the server. For tasks with many events,
 * this loop fetches all pages before returning — the caller receives the
 * complete set. The 1-second buffer in the socket handler deduplicates any
 * live events that arrive concurrently via mergeEventsByCursor (deterministic
 * eventId dedup).
 */
async function fetchReplay(
  taskId: string,
  fromSeq: number,
  fromSubseq: number,
): Promise<Omit<ReplayResponse, 'nextCursor'>> {
  let allEvents: TaskEventEnvelope[] = [];
  let hasGap = false;
  let oldestRetainedSeq = 0;
  let cursor: { fromSeq: number; fromSubseq: number } | null = { fromSeq, fromSubseq };

  while (cursor !== null) {
    const page = await fetchReplayPage(taskId, cursor.fromSeq, cursor.fromSubseq);
    if (page.hasGap) hasGap = true;
    if (allEvents.length === 0) oldestRetainedSeq = page.oldestRetainedSeq;
    allEvents = allEvents.concat(page.events);
    cursor = page.nextCursor;
  }

  return { events: allEvents, hasGap, oldestRetainedSeq };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param taskId The task to stream events for. Pass null/undefined to disable.
 */
export function useTaskEventStream(
  taskId: string | null | undefined,
): UseTaskEventStreamResult {
  // Applied events in sorted order
  const [applied, setApplied] = useState<TaskEventEnvelope[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [gap, setGap] = useState(false);

  // Buffer for out-of-order events (cleared and flushed every 1s)
  const bufferRef = useRef<TaskEventEnvelope[]>([]);
  // Stable reference to applied events for callbacks
  const appliedRef = useRef<TaskEventEnvelope[]>([]);
  appliedRef.current = applied;

  // ── Flush buffer ────────────────────────────────────────────────────────
  const flushBuffer = useCallback(() => {
    if (bufferRef.current.length === 0) return;
    const incoming = [...bufferRef.current];
    bufferRef.current = [];

    setApplied((prev) => {
      const gapRange = detectGap(prev, incoming);
      if (gapRange) {
        setGap(true);
        // Gap detected — emit task.degraded via state (replay will be triggered)
      }
      return mergeEventsByCursor(prev, incoming);
    });
  }, []);

  // ── Replay fetch and reconcile ───────────────────────────────────────────
  const doReplay = useCallback(
    async (reason?: 'reconnect' | 'periodic' | 'gap') => {
      if (!taskId) return;
      const cursor = getCursor(appliedRef.current);
      try {
        const result = await fetchReplay(
          taskId,
          cursor.taskSequence,
          cursor.eventSubsequence,
        );

        if (result.hasGap) {
          setDegraded(true);
          setGap(true);
        }

        if (result.events.length > 0) {
          // S5: Race safety — initial replay and WS live events can arrive
          // concurrently. mergeEventsByCursor deduplicates by deterministic
          // eventId (task:{taskId}:{taskSequence}:{eventSubsequence}:{kind}),
          // so overlapping events from replay and the WS buffer are safe to merge.
          // The 1-second flush buffer in the socket handler provides an additional
          // ordering window for out-of-order delivery.
          setApplied((prev) => mergeEventsByCursor(prev, result.events));
        }

        if (reason === 'gap' && !result.hasGap) {
          setGap(false);
        }
      } catch (err) {
        // S5: structured error log so replay failures are visible in observability.
        // Will retry on the next periodic tick (60s) or on the next reconnect.
        console.error('[useTaskEventStream] replay fetch failed', {
          taskId,
          reason,
          cursor: getCursor(appliedRef.current),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [taskId],
  );

  // ── Main effect: join room, subscribe, set up timers ────────────────────
  useEffect(() => {
    if (!taskId) return;

    const socket = getSocket();
    if (!socket) return;

    // Join task room
    socket.emit('join:task', taskId);

    // 1-second flush interval for out-of-order arrival
    const flushInterval = setInterval(flushBuffer, 1_000);

    // 60-second periodic re-fetch while page is visible
    const periodicInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void doReplay('periodic');
      }
    }, 60_000);

    // Handle incoming events
    const handleEvent = (data: unknown) => {
      const envelope = data as TaskEventEnvelope;
      if (!envelope || typeof envelope.eventId !== 'string') return;
      if (markSeen(envelope.eventId)) return; // dedup

      // task.degraded: immediate replay
      if (envelope.payload?.kind === 'task.degraded') {
        setDegraded(true);
        void doReplay('gap');
        return;
      }

      bufferRef.current.push(envelope);
    };

    socket.on('task:execution-event', handleEvent);

    // On reconnect: rejoin room and replay missed events
    const unsubReconnect = onReconnect(() => {
      socket.emit('join:task', taskId);
      void doReplay('reconnect');
    });

    // Initial replay in case we missed events before joining
    void doReplay('reconnect');

    return () => {
      socket.emit('leave:task', taskId);
      socket.off('task:execution-event', handleEvent);
      clearInterval(flushInterval);
      clearInterval(periodicInterval);
      unsubReconnect();
    };
  }, [taskId, flushBuffer, doReplay]);

  // Extract plain TaskEvent objects from envelopes for consumers
  const events = applied.map((e) => e.payload);

  return { events, degraded, gap };
}
