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
import { executions, agentRuns, agentConversations, subaccounts, workflowRuns } from '../db/schema/index.js';
import { orgUserRoles, permissionSetItems, systemAgents } from '../db/schema/index.js';
import { resolveAgentRunVisibility } from '../lib/agentRunVisibility.js';

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

  // ── Join an agent run room (full AGENTS_VIEW gate) ─────────────────
  //
  // Spec: tasks/live-agent-execution-log-spec.md §7.1. The socket is a
  // push channel; a user who cannot pull via the HTTP snapshot endpoint
  // must not receive live events either. We check both:
  //   1. Run belongs to the socket's current org context.
  //   2. `resolveAgentRunVisibility` returns canView: true for this user.
  //
  // The permission lookup runs once per join, not per event — acceptable
  // latency. Socket is cached on `socket.data._agentRunOrgPerms` so a
  // user who joins many rooms doesn't re-query for every join.
  socket.on('join:agent-run', async (runId: unknown) => {
    if (!isValidUUID(runId)) return;
    try {
      const [run] = await db
        .select({
          id: agentRuns.id,
          organisationId: agentRuns.organisationId,
          subaccountId: agentRuns.subaccountId,
          agentId: agentRuns.agentId,
          executionScope: agentRuns.executionScope,
        })
        .from(agentRuns)
        .where(and(eq(agentRuns.id, runId), eq(agentRuns.organisationId, orgId)));
      if (!run) return;

      // Load (and cache) this user's org permission set so repeated joins
      // don't re-query the permission-set table.
      let orgPerms = (socket.data as { _agentRunOrgPerms?: Set<string> })._agentRunOrgPerms;
      if (!orgPerms) {
        if (user.role === 'system_admin' || user.role === 'org_admin') {
          orgPerms = new Set<string>();
        } else {
          const rows = await db
            .select({ permissionKey: permissionSetItems.permissionKey })
            .from(orgUserRoles)
            .innerJoin(
              permissionSetItems,
              eq(permissionSetItems.permissionSetId, orgUserRoles.permissionSetId),
            )
            .where(
              and(
                eq(orgUserRoles.userId, user.id),
                eq(orgUserRoles.organisationId, orgId),
              ),
            );
          orgPerms = new Set(rows.map((r) => r.permissionKey));
        }
        (socket.data as { _agentRunOrgPerms?: Set<string> })._agentRunOrgPerms = orgPerms;
      }

      // Detect system-agent runs so `resolveAgentRunVisibility`'s tier
      // rules kick in for non-admin joiners (system-tier is system-admin-only).
      const [sysAgent] = await db
        .select({ id: systemAgents.id })
        .from(systemAgents)
        .where(eq(systemAgents.id, run.agentId));

      const visibility = resolveAgentRunVisibility(
        {
          organisationId: run.organisationId,
          subaccountId: run.subaccountId,
          executionScope: run.executionScope as 'subaccount' | 'org',
          isSystemRun: Boolean(sysAgent),
        },
        {
          id: user.id,
          role: user.role,
          organisationId: orgId,
          orgPermissions: orgPerms,
        },
      );
      if (!visibility.canView) return;

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

  // ── Join the system incidents room (system-admin only) ──────────────
  socket.on('join:sysadmin', () => {
    if (socket.data.user?.role !== 'system_admin') return;
    socket.join('system:sysadmin');
  });

  socket.on('leave:sysadmin', () => {
    socket.leave('system:sysadmin');
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

  // ── Join a workflow run room (validated against org ownership) ──────
  socket.on('join:workflow-run', async (runId: unknown) => {
    if (!isValidUUID(runId)) return;
    try {
      const [run] = await db.select({ id: workflowRuns.id })
        .from(workflowRuns)
        .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.organisationId, orgId)));
      if (!run) return;
      socket.join(`workflow-run:${runId}`);
    } catch {
      // DB error — silently reject
    }
  });

  socket.on('leave:workflow-run', (runId: unknown) => {
    if (!isValidUUID(runId)) return;
    socket.leave(`workflow-run:${runId}`);
  });

  // Clean up on disconnect — Socket.IO auto-removes from all rooms
  socket.on('disconnect', () => {
    // No manual cleanup needed; Socket.IO handles room removal
  });
}
