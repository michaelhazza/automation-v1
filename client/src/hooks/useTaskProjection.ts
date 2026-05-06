import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../lib/api';
import { useTaskEventStream } from './useTaskEventStream';
import { applyTaskEvent } from './useTaskProjectionPure';
import { INITIAL_TASK_PROJECTION } from '../../../shared/types/taskProjection';
import type { TaskProjection } from '../../../shared/types/taskProjection';
import type { TaskEventEnvelope } from '../../../shared/types/taskEvent';

const FULL_REBUILD_INTERVAL_MS = 20 * 60 * 1000;
const PERIODIC_INTERVAL_MS = 60 * 1000;
const FULL_REBUILD_TICK = 5;

// Soft cap on the eventId-dedup Set — at typical task-event rates (<100/min)
// this lasts ~15 minutes which exceeds the full-rebuild interval. Beyond this
// the oldest entries are dropped (FIFO). The reducer's cursor short-circuit
// is the actual correctness mechanism; this Set is belt-and-braces so a future
// reducer change cannot accidentally re-introduce duplicates.
const SEEN_EVENT_ID_CAP = 2000;

export function useTaskProjection(taskId: string | undefined): {
  projection: TaskProjection;
  reconcileNow: () => void;
} {
  const [projection, setProjection] = useState<TaskProjection>(INITIAL_TASK_PROJECTION);
  const tickCount = useRef(0);
  const lastFullRebuildAt = useRef<number>(0);
  // Insertion-ordered Set: eldest entry is the first-iterated; we evict from
  // the front when the size exceeds the cap.
  const seenEventIds = useRef<Set<string>>(new Set());

  const noteSeen = useCallback((eventId: string): boolean => {
    if (seenEventIds.current.has(eventId)) return false;
    seenEventIds.current.add(eventId);
    if (seenEventIds.current.size > SEEN_EVENT_ID_CAP) {
      const firstKey = seenEventIds.current.values().next().value;
      if (firstKey !== undefined) seenEventIds.current.delete(firstKey);
    }
    return true;
  }, []);

  const doFullRebuild = useCallback(async () => {
    if (!taskId) return;
    try {
      const { data } = await api.get<{ events: TaskEventEnvelope[]; hasGap: boolean }>(
        `/api/tasks/${taskId}/event-stream/replay?fromSeq=0&fromSubseq=0`
      );
      lastFullRebuildAt.current = Date.now();
      // Full rebuild resets state, so the dedup Set must reset too — otherwise
      // events older than the cap window would be incorrectly skipped.
      seenEventIds.current = new Set();
      setProjection(() => {
        let state = { ...INITIAL_TASK_PROJECTION };
        for (const ev of data.events) {
          if (noteSeen(ev.eventId)) {
            state = applyTaskEvent(state, ev);
          }
        }
        return state;
      });
    } catch (err: unknown) {
      // Network error during rebuild — keep existing projection. Surface to the
      // console so a sustained outage shows up in browser logs rather than
      // failing silently.
      // eslint-disable-next-line no-console
      console.warn('useTaskProjection.full_rebuild_failed', {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [taskId, noteSeen]);

  const doDeltaReconcile = useCallback(async () => {
    if (!taskId) return;
    tickCount.current += 1;
    const timeSinceLastFull = Date.now() - lastFullRebuildAt.current;
    if (tickCount.current % FULL_REBUILD_TICK === 0 || timeSinceLastFull > FULL_REBUILD_INTERVAL_MS) {
      tickCount.current = 0;
      await doFullRebuild();
      return;
    }
    setProjection(prev => {
      api.get<{ events: TaskEventEnvelope[] }>(
        `/api/tasks/${taskId}/event-stream/replay?fromSeq=${prev.lastEventSeq}&fromSubseq=${prev.lastEventSubseq}`
      ).then(({ data }) => {
        if (data.events.length === 0) return;
        setProjection(p => {
          let s = p;
          // Two-layer dedup: seenEventIds Set catches duplicate eventIds at
          // the hook boundary; reducer's cursor short-circuit catches
          // anything the Set misses (e.g. eviction past the cap, or a
          // reducer-direct call from the socket path). Delta cursor is
          // exclusive (server uses strictly-greater-than at
          // agentExecutionEventService.ts:714) so overlap should be rare.
          for (const ev of data.events) {
            if (noteSeen(ev.eventId)) {
              s = applyTaskEvent(s, ev);
            }
          }
          return s;
        });
      }).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('useTaskProjection.delta_reconcile_failed', {
          taskId,
          fromSeq: prev.lastEventSeq,
          fromSubseq: prev.lastEventSubseq,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      return prev;
    });
  }, [taskId, doFullRebuild, noteSeen]);

  useTaskEventStream(taskId, useCallback((envelope: TaskEventEnvelope) => {
    setProjection(prev => {
      if (!noteSeen(envelope.eventId)) return prev;
      const next = applyTaskEvent(prev, envelope);
      if (envelope.payload.kind === 'task.degraded') {
        doFullRebuild();
      }
      return next;
    });
  }, [doFullRebuild, noteSeen]));

  useEffect(() => {
    if (!taskId) return;
    doFullRebuild();
    const interval = setInterval(doDeltaReconcile, PERIODIC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [taskId, doFullRebuild, doDeltaReconcile]);

  return { projection, reconcileNow: doFullRebuild };
}
