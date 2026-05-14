/**
 * React hook for subscribing to a task's execution event stream over WebSocket.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/spec.md Chunk 9.
 *
 * Joins the `task:${taskId}` room on mount and leaves on cleanup.
 * Deduplicates events by eventId using a ref-based Set.
 */

import { useEffect, useRef } from 'react';
import { getSocket } from '../lib/socket';
import type { TaskEventEnvelope } from '../../../shared/types/taskEvent';

export function useTaskEventStream(
  taskId: string | undefined,
  onEvent: (envelope: TaskEventEnvelope) => void,
): void {
  const seenIds = useRef(new Set<string>());
  // Keep onEvent stable across renders to avoid re-subscribing on every render.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!taskId) return;
    const socket = getSocket();
    if (!socket) return;

    socket.emit('join:task', { taskId });

    const handleEvent = (envelope: TaskEventEnvelope) => {
      if (seenIds.current.has(envelope.eventId)) return; // dedup
      seenIds.current.add(envelope.eventId);
      onEventRef.current(envelope);
    };

    socket.on('task:execution-event', handleEvent);

    return () => {
      socket.off('task:execution-event', handleEvent);
      socket.emit('leave:task', { taskId });
    };
  }, [taskId]);
}
