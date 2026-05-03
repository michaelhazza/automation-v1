/**
 * WebSocket event emitters.
 *
 * Every event is wrapped in a standard envelope that includes:
 *   - eventId:   UUID for client-side dedup / idempotency
 *   - timestamp: ISO 8601, enables stale-event rejection
 *   - type:      the event name (mirrors the Socket.IO event key)
 *   - entityId:  the primary resource this event refers to
 *   - payload:   the actual data
 *
 * If the WebSocket server hasn't been initialised (e.g. during tests),
 * emit calls are silently ignored so services don't need to guard.
 */

import { randomUUID } from 'crypto';
import { getIO } from './index.js';
import type { TaskEventEnvelope } from '../../shared/types/taskEvent.js';

// ─── Observability counters ───────────────────────────────────────────────────

let totalEventsEmitted = 0;
let lastLogTime = Date.now();
const EVENT_LOG_INTERVAL_MS = 60_000; // log stats every 60s

function logStats(): void {
  const now = Date.now();
  if (now - lastLogTime >= EVENT_LOG_INTERVAL_MS) {
    const io = getIO();
    const connectionCount = io?.engine?.clientsCount ?? 0;
    console.log(`[WebSocket] Stats — connections: ${connectionCount}, events emitted (total): ${totalEventsEmitted}`);
    lastLogTime = now;
  }
}

// ─── Envelope builder ─────────────────────────────────────────────────────────

interface EventEnvelope {
  eventId: string;
  type: string;
  entityId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

function buildEnvelope(
  type: string,
  entityId: string,
  data: Record<string, unknown>
): EventEnvelope {
  return {
    eventId: randomUUID(),
    type,
    entityId,
    timestamp: new Date().toISOString(),
    payload: data,
  };
}

function emitToRoom(room: string, event: string, entityId: string, data: Record<string, unknown>): void {
  const io = getIO();
  if (!io) return;
  const envelope = buildEnvelope(event, entityId, data);
  io.to(room).emit(event, envelope);
  totalEventsEmitted++;
  logStats();
}

// ─── Execution events ─────────────────────────────────────────────────────────

export function emitExecutionUpdate(
  executionId: string,
  event: string,
  data: Record<string, unknown>
): void {
  emitToRoom(`execution:${executionId}`, event, executionId, data);
}

export function emitExecutionToSubaccount(
  subaccountId: string,
  event: string,
  data: Record<string, unknown>
): void {
  emitToRoom(`subaccount:${subaccountId}`, event, subaccountId, data);
}

// ─── Agent run events ─────────────────────────────────────────────────────────

export function emitAgentRunUpdate(
  runId: string,
  event: string,
  data: Record<string, unknown>
): void {
  emitToRoom(`agent-run:${runId}`, event, runId, data);
}

// ─── Live Agent Execution Log — per-run execution event ─────────────────────
// Spec: tasks/live-agent-execution-log-spec.md §5.10. The `eventId` carries
// a deterministic `${runId}:${sequenceNumber}:${eventType}` shape so the
// existing client dedup LRU works without changes. NOT routed through
// buildEnvelope because the envelope is pre-assembled upstream.

export function emitAgentExecutionEvent(
  runId: string,
  envelope: {
    eventId: string;
    type: 'agent-run:execution-event';
    entityId: string;
    timestamp: string;
    payload: Record<string, unknown>;
  },
): void {
  const io = getIO();
  if (!io) return;
  io.to(`agent-run:${runId}`).emit(envelope.type, envelope);
  totalEventsEmitted++;
  logStats();
}

// ─── Conversation events ──────────────────────────────────────────────────────

export function emitConversationUpdate(
  conversationId: string,
  event: string,
  data: Record<string, unknown>
): void {
  emitToRoom(`conversation:${conversationId}`, event, conversationId, data);
}

// ─── Subaccount-scoped events (sidebar badges, dashboard) ─────────────────────

export function emitSubaccountUpdate(
  subaccountId: string,
  event: string,
  data: Record<string, unknown>
): void {
  emitToRoom(`subaccount:${subaccountId}`, event, subaccountId, data);
}

// ─── Task execution events ─────────────────────────────────────────────────
// Spec: docs/workflows-dev-spec.md §8. Per-task room. The envelope is
// pre-assembled by taskEventService so we emit it verbatim (same pattern
// as emitAgentExecutionEvent). Room name: `task:${taskId}`.

// S1: Per-process server-side dedup for emitTaskEvent. A retried appendAndEmit
// (e.g. after a transient DB error that still committed the row) could call
// emitTaskEvent twice with the same deterministic eventId. The client deduplicates
// via eventId, but a server-side check avoids the unnecessary WS traffic.
// LRU: evict entries beyond MAX_SEEN_EVENTS or older than TTL_MS (60s).
const SEEN_EVENT_TTL_MS = 60_000;
const SEEN_EVENT_MAX = 2_000;
const seenTaskEventIds = new Map<string, number>(); // eventId -> timestamp

function isAlreadyEmittedTaskEvent(eventId: string): boolean {
  const now = Date.now();
  // Evict expired entries when map is large (amortised O(1) per call).
  if (seenTaskEventIds.size >= SEEN_EVENT_MAX) {
    for (const [id, ts] of seenTaskEventIds) {
      if (now - ts > SEEN_EVENT_TTL_MS) {
        seenTaskEventIds.delete(id);
      }
      // Stop after clearing enough room.
      if (seenTaskEventIds.size < SEEN_EVENT_MAX) break;
    }
  }
  if (seenTaskEventIds.has(eventId)) return true;
  seenTaskEventIds.set(eventId, now);
  return false;
}

export function emitTaskEvent(envelope: TaskEventEnvelope): void {
  const io = getIO();
  if (!io) return;
  // S1: server-side dedup — skip if this eventId was recently emitted.
  if (isAlreadyEmittedTaskEvent(envelope.eventId)) return;
  io.to(`task:${envelope.entityId}`).emit(envelope.type, envelope);
  totalEventsEmitted++;
  logStats();
}

// ─── Workflow run events ──────────────────────────────────────────────────────
// Spec: tasks/playbooks-spec.md §8.2. Per-run room with monotonic
// sequence number plus a coarse subaccount-level event for dashboards.

export function emitWorkflowRunUpdate(
  runId: string,
  event: string,
  data: Record<string, unknown>
): void {
  emitToRoom(`workflow-run:${runId}`, event, runId, data);
}

// ─── Org-wide events ──────────────────────────────────────────────────────────

export function emitOrgUpdate(
  orgId: string,
  event: string,
  data: Record<string, unknown>
): void {
  emitToRoom(`org:${orgId}`, event, orgId, data);
}

// ─── Sprint 5 P4.1: Agent clarification events ─────────────────────────────

export function emitAwaitingClarification(
  runId: string,
  data: { question: string; blockedBy?: string }
): void {
  emitToRoom(`agent-run:${runId}`, 'agent:run:awaiting-clarification', runId, data);
}

// ─── Sprint 5 P4.3: Agent plan events ───────────────────────────────────────

export function emitAgentRunPlan(
  runId: string,
  data: { plan: unknown }
): void {
  emitToRoom(`agent-run:${runId}`, 'agent:run:plan', runId, data);
}

// ─── Universal Brief events ───────────────────────────────────────────────────

export function emitBriefArtefactNew(
  briefId: string,
  data: Record<string, unknown>,
): void {
  emitToRoom(`brief:${briefId}`, 'brief-artefact:new', briefId, data);
}

export function emitBriefArtefactUpdated(
  briefId: string,
  data: Record<string, unknown>,
): void {
  emitToRoom(`brief:${briefId}`, 'brief-artefact:updated', briefId, data);
}

// ─── System-admin incident events ────────────────────────────────────────────

export function emitToSysadmin(
  event: string,
  entityId: string,
  data: Record<string, unknown>
): void {
  emitToRoom('system:sysadmin', event, entityId, data);
}

// ─── Observability exports (for health endpoint or admin) ─────────────────────

export function getWebSocketStats(): { totalEventsEmitted: number; connectionCount: number } {
  const io = getIO();
  return {
    totalEventsEmitted,
    connectionCount: io?.engine?.clientsCount ?? 0,
  };
}
