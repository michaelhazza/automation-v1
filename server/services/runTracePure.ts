// runTracePure.ts — pure viewer projection for agent run traces.
// Personal-assistant-v2-operator spec §5.4 (privacy invariant).

export interface ProjectableEvent {
  eventType: string;
  payload: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ProjectableRun {
  ownerUserId: string | null;
  events: ProjectableEvent[];
}

/**
 * Project a run's events for a specific viewer.
 *
 * Invariant: owner sees everything. Non-owner (initiator) sees only
 * cross_owner_substep.* events; all other events are redacted to protect
 * owner-private data.
 *
 * Idempotent: applying twice produces the same result as applying once.
 *
 * Throws when viewerUserId is falsy (programmer error).
 */
export function runTraceProjectionForViewer(
  viewerUserId: string,
  run: ProjectableRun,
): ProjectableRun {
  if (!viewerUserId) {
    throw new Error('runTraceProjectionForViewer: viewerUserId is required');
  }
  // Subaccount-owned agent: no cross-owner context, return as-is
  if (run.ownerUserId === null) return run;
  // Owner sees everything
  if (viewerUserId === run.ownerUserId) return run;
  // Initiator view: cross_owner_substep.* events plus run-trace-level lifecycle
  // events that non-owners need to see (delegation milestones, review decisions,
  // run status transitions). Vocabulary matches RunTraceEventType from the trace
  // service UNION — none of these carry owner-private payload.
  const NON_OWNER_ALLOWED_TYPES = new Set([
    'delegation_spawned',
    'delegation_completed',
    'review_requested',
    'review_decided',
    'run_started',
    'run_terminated',
  ]);
  const filteredEvents = run.events.filter((e) =>
    e.eventType.startsWith('cross_owner_substep.') || NON_OWNER_ALLOWED_TYPES.has(e.eventType),
  );
  return { ...run, events: filteredEvents };
}
