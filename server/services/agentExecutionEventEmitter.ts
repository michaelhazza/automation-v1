// Fire-and-forget wrapper around appendEvent — intended for use at
// emission sites inside agent-side services. Swallows every error and
// never throws into the caller. The append service already retries
// critical events + records metrics/logs on drop; this helper only
// exists to keep emission-site boilerplate to one line.
//
// Usage:
//
//   import { tryEmitAgentEvent } from './agentExecutionEventEmitter.js';
//
//   tryEmitAgentEvent({
//     runId,
//     organisationId,
//     subaccountId,
//     sourceService: 'workspaceMemoryService',
//     payload: { eventType: 'memory.retrieved', critical: false, ... },
//     linkedEntity: { type: 'memory_entry', id: top.id },
//   });
//
// The emission is `await`ed internally but the returned promise is
// discarded by default — callers that want to hold the agent loop until
// the emit completes can use `await emitAgentEvent(...)` instead.

import { appendEvent, type AppendEventInput } from './agentExecutionEventService.js';
import { logger } from '../lib/logger.js';

/** Fire-and-forget emission. Never throws into the caller. */
export function tryEmitAgentEvent(input: AppendEventInput): void {
  void emitAgentEvent(input);
}

/** Awaitable emission — use from paths that genuinely want to block. */
export async function emitAgentEvent(input: AppendEventInput): Promise<void> {
  try {
    await appendEvent(input);
  } catch (err) {
    // appendEvent itself should never throw in P1 (it catches its own
    // retry failures). If something slips through, log it and keep
    // going — the log-table write must never fail the agent run.
    logger.warn('agentExecutionEventEmitter.unexpected_throw', {
      runId: input.runId,
      eventType: input.payload.eventType,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
