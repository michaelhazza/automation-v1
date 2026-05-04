/**
 * Task event stream replay endpoint.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/spec.md Chunk 9.
 *
 * GET /api/tasks/:taskId/event-stream/replay?fromSeq=N&fromSubseq=M
 *
 * Returns events with (task_sequence, event_subsequence) > (fromSeq, fromSubseq).
 * When the cursor predates the oldest retained event, returns hasGap: true.
 *
 * Auth: authenticate + AGENTS_VIEW (callers must be able to view agent runs
 * in the org to receive task execution events — consistent with the WS gate).
 */

import { Router } from 'express';
import { eq, and, min } from 'drizzle-orm';
import { authenticate, requireOrgPermission, hasOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { streamEventsByTask } from '../services/agentExecutionEventService.js';
import type { PermissionMaskUserContext } from '../lib/agentRunEditPermissionMaskPure.js';
import { agentExecutionEvents } from '../db/schema/agentExecutionEvents.js';
import { tasks } from '../db/schema/tasks.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';

const router = Router();

router.get(
  '/api/tasks/:taskId/event-stream/replay',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const orgId = req.orgId!;
    const user = req.user!;

    const fromSeq = parseInt(req.query.fromSeq as string ?? '0', 10) || 0;
    const fromSubseq = parseInt(req.query.fromSubseq as string ?? '0', 10) || 0;

    // Verify task belongs to the caller's org.
    const db = getOrgScopedDb('taskEventStream.replay');
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, orgId)));

    if (!task) {
      res.status(404).json({ error: 'task_not_found' });
      return;
    }

    // Find the oldest retained task_sequence for this task (for gap detection).
    const [oldestRow] = await db
      .select({ oldestSeq: min(agentExecutionEvents.taskSequence) })
      .from(agentExecutionEvents)
      .where(eq(agentExecutionEvents.taskId, taskId));

    const oldestRetainedSeq = oldestRow?.oldestSeq ?? null;

    // Build a minimal PermissionMaskUserContext for the event permission mask.
    await hasOrgPermission(req, ORG_PERMISSIONS.AGENTS_VIEW);
    const orgPermissions: ReadonlySet<string> = req._orgPermissionCache ?? new Set<string>();
    const isSuper = user.role === 'system_admin' || user.role === 'org_admin';
    const forUser: PermissionMaskUserContext = {
      id: user.id,
      role: user.role,
      organisationId: orgId,
      orgPermissions,
      canManageWorkspace: isSuper || orgPermissions.has('org.workspace.manage'),
      canManageSkills: isSuper || orgPermissions.has('subaccount.skills.manage'),
      canEditAgents: isSuper || orgPermissions.has('org.agents.edit'),
    };
    const page = await streamEventsByTask(taskId, {
      fromSeq,
      fromSubseq,
      forUser,
    });

    // Gap detection: if caller's cursor is before the oldest retained event.
    const hasGap =
      oldestRetainedSeq !== null && fromSeq < oldestRetainedSeq;

    res.json({
      events: page.events,
      hasGap,
      oldestRetainedSeq,
    });
  }),
);

export default router;
