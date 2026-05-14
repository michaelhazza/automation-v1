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
 * Privacy invariant: owner sees everything. Non-owner (initiator-side) sees
 * only the allow-listed event types defined in NON_OWNER_ALLOWED_TYPES below
 * plus any event whose type starts with `cross_owner_substep.`. Everything
 * else (tool calls, agent run lifecycle, memory reads, LLM payloads, etc.) is
 * redacted to protect owner-private payload.
 *
 * Adding a new event type to the non-owner allow-list MUST verify the payload
 * carries no owner-private data — these are run-trace lifecycle signals only.
 *
 * Idempotent: applying twice produces the same result as applying once.
 *
 * Throws when viewerUserId is falsy (programmer error).
 *
 * Caller contract: the `ownerUserId` field of the input represents three
 * distinct states. The route layer MUST distinguish them before calling:
 *   - string  — run owned by a specific user; non-owner viewers get the projection.
 *   - null    — run is subaccount-owned (no per-user owner); everyone sees all events.
 *   - never undefined — a failed owner lookup must be handled at the route layer
 *                       (404 / empty response) and NEVER coerced to null here.
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
