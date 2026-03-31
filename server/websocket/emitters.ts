/**
 * WebSocket event emitters.
 *
 * Thin helper functions that services call to push real-time updates
 * to connected clients. Each function targets a specific Socket.IO room.
 *
 * If the WebSocket server hasn't been initialised (e.g. during tests),
 * emit calls are silently ignored so services don't need to guard.
 */

import { getIO } from './index.js';

// ─── Execution events ─────────────────────────────────────────────────────────

export function emitExecutionUpdate(
  executionId: string,
  event: string,
  data: Record<string, unknown>
): void {
  const io = getIO();
  if (!io) return;
  // Emit to clients watching this specific execution
  io.to(`execution:${executionId}`).emit(event, { executionId, ...data });
}

export function emitExecutionToSubaccount(
  subaccountId: string,
  event: string,
  data: Record<string, unknown>
): void {
  const io = getIO();
  if (!io) return;
  io.to(`subaccount:${subaccountId}`).emit(event, data);
}

// ─── Agent run events ─────────────────────────────────────────────────────────

export function emitAgentRunUpdate(
  runId: string,
  event: string,
  data: Record<string, unknown>
): void {
  const io = getIO();
  if (!io) return;
  io.to(`agent-run:${runId}`).emit(event, { runId, ...data });
}

// ─── Conversation events ──────────────────────────────────────────────────────

export function emitConversationUpdate(
  conversationId: string,
  event: string,
  data: Record<string, unknown>
): void {
  const io = getIO();
  if (!io) return;
  io.to(`conversation:${conversationId}`).emit(event, { conversationId, ...data });
}

// ─── Subaccount-scoped events (sidebar badges, dashboard) ─────────────────────

export function emitSubaccountUpdate(
  subaccountId: string,
  event: string,
  data: Record<string, unknown>
): void {
  const io = getIO();
  if (!io) return;
  io.to(`subaccount:${subaccountId}`).emit(event, { subaccountId, ...data });
}

// ─── Org-wide events ──────────────────────────────────────────────────────────

export function emitOrgUpdate(
  orgId: string,
  event: string,
  data: Record<string, unknown>
): void {
  const io = getIO();
  if (!io) return;
  io.to(`org:${orgId}`).emit(event, { orgId, ...data });
}
