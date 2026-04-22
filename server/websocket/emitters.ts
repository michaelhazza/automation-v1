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

// ─── Playbook run events ──────────────────────────────────────────────────────
// Spec: tasks/playbooks-spec.md §8.2. Per-run room with monotonic
// sequence number plus a coarse subaccount-level event for dashboards.

export function emitPlaybookRunUpdate(
  runId: string,
  event: string,
  data: Record<string, unknown>
): void {
  emitToRoom(`playbook-run:${runId}`, event, runId, data);
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

// ─── Observability exports (for health endpoint or admin) ─────────────────────

export function getWebSocketStats(): { totalEventsEmitted: number; connectionCount: number } {
  const io = getIO();
  return {
    totalEventsEmitted,
    connectionCount: io?.engine?.clientsCount ?? 0,
  };
}
