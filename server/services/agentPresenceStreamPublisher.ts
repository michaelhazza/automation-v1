/**
 * In-process SSE publisher for agent presence events.
 *
 * Maintains a subscriber registry and per-scope ring buffer for reconnect replay.
 * Agent Workspace Chunk 9.
 */

import { logger } from '../lib/logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PresenceStreamEvent {
  agentId: string;
  organisationId?: string;  // used to scope fanOut; absent on server_heartbeat
  eventTimestamp: string;  // ISO string
  serverNow: string;       // ISO string, freshly computed at emission
  eventId: string;
  data: unknown;
  eventType:
    | 'presence_state_changed'
    | 'current_focus_updated'
    | 'observation_appended'
    | 'activity_row'
    | 'working_time_bucket_updated'
    | 'server_heartbeat';
  truncated?: boolean;
}

export type PresenceScope =
  | { kind: 'agent'; agentId: string; organisationId: string }
  | { kind: 'workspace'; subaccountId: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_EVENT_BYTES = 32_768; // 32 KB
const RING_BUFFER_MAX = 300;
const TRUNCATION_LOG_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 h

// ── Module-level singletons ───────────────────────────────────────────────────

// scopeKey → subscriberId → callback
const subscriberRegistry = new Map<string, Map<string, (event: PresenceStreamEvent) => void>>();

// scopeKey → sorted ring buffer (eventTimestamp ASC, eventId ASC)
const ringBuffers = new Map<string, PresenceStreamEvent[]>();

// eventType → last log timestamp (for truncation rate limiting)
const truncationLastLogAt = new Map<string, number>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function scopeKey(scope: PresenceScope): string {
  return scope.kind === 'agent'
    ? `agent:${scope.organisationId}:${scope.agentId}`
    : `workspace:${scope.subaccountId}`;
}

/**
 * Compare two events canonically: (eventTimestamp ASC, eventId ASC).
 */
function compareEvents(a: PresenceStreamEvent, b: PresenceStreamEvent): number {
  if (a.eventTimestamp < b.eventTimestamp) return -1;
  if (a.eventTimestamp > b.eventTimestamp) return 1;
  if (a.eventId < b.eventId) return -1;
  if (a.eventId > b.eventId) return 1;
  return 0;
}

/**
 * Insertion-sort a new event into the ring buffer (buffer is kept sorted).
 * When at capacity, evict the smallest event (index 0 after insertion-sort).
 */
function insertIntoRingBuffer(buffer: PresenceStreamEvent[], event: PresenceStreamEvent): void {
  // Find insertion position via linear scan (buffer is small, max 300)
  let i = buffer.length;
  while (i > 0 && compareEvents(buffer[i - 1], event) > 0) {
    i--;
  }
  buffer.splice(i, 0, event);

  // Evict smallest if over capacity (index 0 = smallest after sorted insert)
  if (buffer.length > RING_BUFFER_MAX) {
    buffer.splice(0, 1);
  }
}

/**
 * Enforce per-event payload cap. Mutates the event in place if over limit.
 */
function enforcePayloadCap(event: PresenceStreamEvent): void {
  const serialised = JSON.stringify(event.data);
  const byteLength = Buffer.byteLength(serialised, 'utf8');
  if (byteLength <= MAX_EVENT_BYTES) return;

  const now = Date.now();
  const lastLogged = truncationLastLogAt.get(event.eventType) ?? 0;
  if (now - lastLogged >= TRUNCATION_LOG_INTERVAL_MS) {
    logger.warn('presence_stream.event_truncated', { eventType: event.eventType, byteLength });
    truncationLastLogAt.set(event.eventType, now);
  }

  event.data = { truncated: true, byteLength };
  event.truncated = true;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Publish an event to all subscribers in the event's agent scope, and insert
 * into the ring buffer.
 *
 * Workspace-scope subscriptions are separate: workspace subscribers call
 * subscribe({ kind: 'workspace', ... }) and receive events fanned out via
 * fanOutToWorkspace(). Agent-scope fanOut only reaches agent-scope subscribers.
 */
export function fanOut(event: PresenceStreamEvent): void {
  // Enforce payload cap before any delivery
  enforcePayloadCap(event);

  // organisationId is required to scope-isolate per-org agent streams (B1)
  const key = `agent:${event.organisationId ?? ''}:${event.agentId}`;

  // Insert into ring buffer for this agent scope
  if (!ringBuffers.has(key)) ringBuffers.set(key, []);
  insertIntoRingBuffer(ringBuffers.get(key)!, event);

  // Deliver to agent-scope subscribers
  const subs = subscriberRegistry.get(key);
  if (subs) {
    for (const send of subs.values()) {
      try {
        send(event);
      } catch {
        // individual subscriber errors must not interrupt fan-out
      }
    }
  }
}

/**
 * Publish an event to all workspace-scope subscribers for a given subaccount,
 * and insert into the workspace ring buffer.
 *
 * Call this in addition to fanOut() when you know the subaccountId.
 */
export function fanOutToWorkspace(subaccountId: string, event: PresenceStreamEvent): void {
  enforcePayloadCap(event);

  const key = `workspace:${subaccountId}`;

  if (!ringBuffers.has(key)) ringBuffers.set(key, []);
  insertIntoRingBuffer(ringBuffers.get(key)!, event);

  const subs = subscriberRegistry.get(key);
  if (subs) {
    for (const send of subs.values()) {
      try {
        send(event);
      } catch {
        // individual subscriber errors must not interrupt fan-out
      }
    }
  }
}

/**
 * Subscribe to events for the given scope.
 * Returns an unsubscribe handle.
 */
export function subscribe(
  scope: PresenceScope,
  subscriberId: string,
  send: (event: PresenceStreamEvent) => void,
): { unsubscribe: () => void } {
  const key = scopeKey(scope);
  if (!subscriberRegistry.has(key)) subscriberRegistry.set(key, new Map());
  subscriberRegistry.get(key)!.set(subscriberId, send);

  return {
    unsubscribe: () => {
      const map = subscriberRegistry.get(key);
      if (map) {
        map.delete(subscriberId);
        if (map.size === 0) subscriberRegistry.delete(key);
      }
    },
  };
}

/**
 * Replay events from the ring buffer since the given lastEventId.
 *
 * - lastEventId === null: return last 10 events.
 * - lastEventId found: return all events canonically after it.
 * - lastEventId not found (too old): return full buffer contents.
 */
export function replaySinceLastEventId(
  scope: PresenceScope,
  lastEventId: string | null,
): PresenceStreamEvent[] {
  const key = scopeKey(scope);
  const buffer = ringBuffers.get(key) ?? [];

  if (lastEventId === null) {
    return buffer.slice(-10);
  }

  const idx = buffer.findIndex((e) => e.eventId === lastEventId);
  if (idx === -1) {
    // Not found — return full buffer
    return [...buffer];
  }

  // Return all events after the found event (canonical order)
  return buffer.slice(idx + 1);
}
