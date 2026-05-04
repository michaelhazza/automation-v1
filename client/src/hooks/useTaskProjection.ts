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

export function useTaskProjection(taskId: string | undefined): {
  projection: TaskProjection;
  reconcileNow: () => void;
} {
  const [projection, setProjection] = useState<TaskProjection>(INITIAL_TASK_PROJECTION);
  const tickCount = useRef(0);
  const lastFullRebuildAt = useRef<number>(0);

  const doFullRebuild = useCallback(async () => {
    if (!taskId) return;
    try {
      const { data } = await api.get<{ events: TaskEventEnvelope[]; hasGap: boolean }>(
        `/api/tasks/${taskId}/event-stream/replay?fromSeq=0&fromSubseq=0`
      );
      lastFullRebuildAt.current = Date.now();
      setProjection(() => {
        let state = { ...INITIAL_TASK_PROJECTION };
        for (const ev of data.events) {
          state = applyTaskEvent(state, ev);
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
  }, [taskId]);

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
          // Reducer is idempotent (cursor short-circuit) — a delta response
          // that overlaps with already-applied socket events drops the
          // duplicates rather than appending them twice.
          for (const ev of data.events) s = applyTaskEvent(s, ev);
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
  }, [taskId, doFullRebuild]);

  useTaskEventStream(taskId, useCallback((envelope: TaskEventEnvelope) => {
    setProjection(prev => {
      const next = applyTaskEvent(prev, envelope);
      if (envelope.payload.kind === 'task.degraded') {
        doFullRebuild();
      }
      return next;
    });
  }, [doFullRebuild]));

  useEffect(() => {
    if (!taskId) return;
    doFullRebuild();
    const interval = setInterval(doDeltaReconcile, PERIODIC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [taskId, doFullRebuild, doDeltaReconcile]);

  return { projection, reconcileNow: doFullRebuild };
}
