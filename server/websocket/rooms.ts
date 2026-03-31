/**
 * WebSocket room management.
 *
 * When a client connects, it can join rooms scoped to specific resources
 * (executions, agent runs, conversations, subaccounts). The server emits
 * events to these rooms so only interested clients receive updates.
 */

import type { Socket } from 'socket.io';

/**
 * Handle a newly authenticated socket connection.
 * Sets up listeners for room join/leave requests.
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

  // ── Join a subaccount room ──────────────────────────────────────────────
  socket.on('join:subaccount', (subaccountId: string) => {
    if (typeof subaccountId !== 'string') return;
    socket.join(`subaccount:${subaccountId}`);
  });

  socket.on('leave:subaccount', (subaccountId: string) => {
    if (typeof subaccountId !== 'string') return;
    socket.leave(`subaccount:${subaccountId}`);
  });

  // ── Join an execution room (for live status updates) ────────────────────
  socket.on('join:execution', (executionId: string) => {
    if (typeof executionId !== 'string') return;
    socket.join(`execution:${executionId}`);
  });

  socket.on('leave:execution', (executionId: string) => {
    if (typeof executionId !== 'string') return;
    socket.leave(`execution:${executionId}`);
  });

  // ── Join an agent run room (for live trace) ─────────────────────────────
  socket.on('join:agent-run', (runId: string) => {
    if (typeof runId !== 'string') return;
    socket.join(`agent-run:${runId}`);
  });

  socket.on('leave:agent-run', (runId: string) => {
    if (typeof runId !== 'string') return;
    socket.leave(`agent-run:${runId}`);
  });

  // ── Join a conversation room (for streaming messages) ───────────────────
  socket.on('join:conversation', (conversationId: string) => {
    if (typeof conversationId !== 'string') return;
    socket.join(`conversation:${conversationId}`);
  });

  socket.on('leave:conversation', (conversationId: string) => {
    if (typeof conversationId !== 'string') return;
    socket.leave(`conversation:${conversationId}`);
  });

  // Clean up on disconnect — Socket.IO auto-removes from all rooms
  socket.on('disconnect', () => {
    // No manual cleanup needed; Socket.IO handles room removal
  });
}
