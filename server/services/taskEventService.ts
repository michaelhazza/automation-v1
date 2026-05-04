/**
 * TaskEventService — validated emit path for task execution events.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/spec.md Chunk 9.
 *
 * This service validates, envelopes, and emits task events to the
 * `task:${taskId}` WebSocket room. It is the write path for non-agent-run
 * origins (pause, stop, resume, gate events). Events that originate from
 * agent runs are persisted by agentExecutionEventService.appendEvent (which
 * handles the DB write + WS emit in one shot) — callers pass taskId there.
 *
 * Sequence allocation: the caller owns taskSequence allocation. The per-task
 * counter lives in tasks.nextEventSeq and is incremented inside the
 * transaction that performs the state change (e.g. pauseRun). This service
 * receives the pre-allocated sequence and emits the WS envelope.
 */

import type { TaskEvent, TaskEventEnvelope } from '../../shared/types/taskEvent.js';
import { validateTaskEvent, validateEventOrigin } from '../../shared/types/taskEventValidator.js';
import { emitTaskEvent } from '../websocket/emitters.js';
import { logger } from '../lib/logger.js';

export async function appendAndEmitTaskEvent(
  taskId: string,
  taskSequence: number,       // pre-allocated — caller owns seq allocation for now
  eventSubsequence: number,   // 0 for single-origin events
  eventOrigin: 'engine' | 'gate' | 'user' | 'orchestrator',
  event: TaskEvent,
): Promise<void> {
  const validation = validateTaskEvent(event);
  if (!validation.ok) {
    logger.warn('task_event_invalid_payload', { taskId, reason: validation.reason });
    return;
  }
  if (!validateEventOrigin(eventOrigin)) {
    logger.warn('task_event_invalid_origin', { taskId, eventOrigin });
    return;
  }

  const envelope: TaskEventEnvelope = {
    eventId: `task:${taskId}:${taskSequence}:${eventSubsequence}:${event.kind}`,
    type: 'task:execution-event',
    entityId: taskId,
    timestamp: new Date().toISOString(),
    eventOrigin,
    taskSequence,
    eventSubsequence,
    eventSchemaVersion: 1,
    payload: event,
  };

  emitTaskEvent(taskId, envelope);
}
