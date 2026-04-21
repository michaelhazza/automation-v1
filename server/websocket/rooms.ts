/**
 * WebSocket room management with multi-tenant isolation.
 *
 * When a client connects, it can join rooms scoped to specific resources.
 * All join requests are validated server-side against the user's org context
 * so a user cannot subscribe to another org's resources.
 */

import type { Socket } from 'socket.io';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { executions, agentRuns, agentConversations, subaccounts, playbookRuns } from '../db/schema/index.js';

// UUID format check — reject malformed IDs early
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * Handle a newly authenticated socket connection.
 * Sets up listeners for room join/leave requests with server-side validation.
 */
export function handleConnection(socket: Socket): void {
  const user = socket.data.user;
  const orgId = socket.data.orgId;

  if (!user || !orgId) {
    socket.disconnect(true);
    return;
  }

  // Auto-join the org room so org-wide broadcasts reach this user
  socket.join(`org:${orgId}`);

  // ── Join a subaccount room (validated against org ownership) ─────────
  socket.on('join:subaccount', async (subaccountId: unknown) => {
    if (!isValidUUID(subaccountId)) return;
    try {
      const [sa] = await db.select({ id: subaccounts.id })
        .from(subaccounts)
        .where(and(eq(subaccounts.id, subaccountId), eq(subaccounts.organisationId, orgId)));
      if (!sa) return; // silently reject — wrong org
      socket.join(`subaccount:${subaccountId}`);
    } catch {
      // DB error — silently reject
    }
  });

  socket.on('leave:subaccount', (subaccountId: unknown) => {
    if (!isValidUUID(subaccountId)) return;
    socket.leave(`subaccount:${subaccountId}`);
  });

  // ── Join an execution room (validated against org ownership) ────────
  socket.on('join:execution', async (executionId: unknown) => {
    if (!isValidUUID(executionId)) return;
    try {
      const [exec] = await db.select({ id: executions.id })
        .from(executions)
        .where(and(eq(executions.id, executionId), eq(executions.organisationId, orgId)));
      if (!exec) return;
      socket.join(`execution:${executionId}`);
    } catch {
      // DB error — silently reject
    }
  });

  socket.on('leave:execution', (executionId: unknown) => {
    if (!isValidUUID(executionId)) return;
    socket.leave(`execution:${executionId}`);
  });

  // ── Join an agent run room (validated against org ownership) ─────────
  socket.on('join:agent-run', async (runId: unknown) => {
    if (!isValidUUID(runId)) return;
    try {
      const [run] = await db.select({ id: agentRuns.id })
        .from(agentRuns)
        .where(and(eq(agentRuns.id, runId), eq(agentRuns.organisationId, orgId)));
      if (!run) return;
      socket.join(`agent-run:${runId}`);
    } catch {
      // DB error — silently reject
    }
  });

  socket.on('leave:agent-run', (runId: unknown) => {
    if (!isValidUUID(runId)) return;
    socket.leave(`agent-run:${runId}`);
  });

  // ── Join a conversation room (validated against org ownership) ──────
  socket.on('join:conversation', async (conversationId: unknown) => {
    if (!isValidUUID(conversationId)) return;
    try {
      const [conv] = await db.select({ id: agentConversations.id })
        .from(agentConversations)
        .where(and(
          eq(agentConversations.id, conversationId),
          eq(agentConversations.organisationId, orgId),
          eq(agentConversations.userId, user.id)
        ));
      if (!conv) return; // wrong org or not the conversation owner
      socket.join(`conversation:${conversationId}`);
    } catch {
      // DB error — silently reject
    }
  });

  socket.on('leave:conversation', (conversationId: unknown) => {
    if (!isValidUUID(conversationId)) return;
    socket.leave(`conversation:${conversationId}`);
  });

  // ── Join the system-wide LLM in-flight room (system-admin only) ─────
  // Spec tasks/llm-inflight-realtime-tracker-spec.md §7. The room carries
  // cross-tenant attribution fields — non-admin sockets are silently
  // rejected to match the pattern used elsewhere in this file (no error
  // disclosure that a privileged room exists).
  socket.on('join:system-llm-inflight', () => {
    if (socket.data.user?.role !== 'system_admin') return;
    socket.join('system:llm-inflight');
  });

  socket.on('leave:system-llm-inflight', () => {
    socket.leave('system:llm-inflight');
  });

  // ── Join a playbook run room (validated against org ownership) ──────
  socket.on('join:playbook-run', async (runId: unknown) => {
    if (!isValidUUID(runId)) return;
    try {
      const [run] = await db.select({ id: playbookRuns.id })
        .from(playbookRuns)
        .where(and(eq(playbookRuns.id, runId), eq(playbookRuns.organisationId, orgId)));
      if (!run) return;
      socket.join(`playbook-run:${runId}`);
    } catch {
      // DB error — silently reject
    }
  });

  socket.on('leave:playbook-run', (runId: unknown) => {
    if (!isValidUUID(runId)) return;
    socket.leave(`playbook-run:${runId}`);
  });

  // Clean up on disconnect — Socket.IO auto-removes from all rooms
  socket.on('disconnect', () => {
    // No manual cleanup needed; Socket.IO handles room removal
  });
}
