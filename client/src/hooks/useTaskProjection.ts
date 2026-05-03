/**
 * useTaskProjection — read-model projection hook.
 *
 * Combines the initial REST replay snapshot with live WebSocket events from
 * useTaskEventStream to produce a deterministic TaskProjection.
 *
 * UI components MUST consume this hook. Reading raw useTaskEventStream events
 * directly in UI components is forbidden (spec §9, read-model contract).
 *
 * Spec: docs/workflows-dev-spec.md §9.
 */

import { useEffect, useRef, useState } from 'react';
import { useTaskEventStream } from './useTaskEventStream.js';
import {
  emptyProjection,
  applyEvent,
  type TaskProjection,
} from './useTaskProjectionPure.js';

export type { TaskProjection };

export interface UseTaskProjectionResult {
  projection: TaskProjection;
  degraded: boolean;
  gap: boolean;
}

/**
 * @param taskId The task to project. Pass null/undefined to get an empty projection.
 * @param taskName Optional pre-loaded task name (from page-level metadata fetch).
 */
export function useTaskProjection(
  taskId: string | null | undefined,
  taskName?: string,
): UseTaskProjectionResult {
  const { envelopes, degraded, gap } = useTaskEventStream(taskId);

  const lastAppliedCountRef = useRef(0);

  const [projection, setProjection] = useState<TaskProjection>(() =>
    emptyProjection(taskId ?? ''),
  );

  useEffect(() => {
    lastAppliedCountRef.current = 0;
    setProjection(emptyProjection(taskId ?? ''));
  }, [taskId]);

  useEffect(() => {
    if (!taskId || envelopes.length === 0) return;
    if (envelopes.length === lastAppliedCountRef.current) return;

    const newEnvelopes = envelopes.slice(lastAppliedCountRef.current);
    lastAppliedCountRef.current = envelopes.length;

    setProjection((prev) => {
      let next = prev;
      for (const envelope of newEnvelopes) {
        next = applyEvent(next, envelope.payload, envelope);
      }
      return next;
    });
  }, [taskId, envelopes]);

  useEffect(() => {
    if (taskName) {
      setProjection((prev) => ({ ...prev, taskName }));
    }
  }, [taskName]);

  return { projection, degraded, gap };
}
