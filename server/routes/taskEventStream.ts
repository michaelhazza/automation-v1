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
import { authenticate, requireOrgPermission, hasOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import {
  streamEventsByTask,
  getOldestRetainedTaskSequence,
} from '../services/agentExecutionEventService.js';
import { taskService } from '../services/taskService.js';
import { resolveActiveRunForTask } from '../services/workflowRunResolverService.js';
import { appendAndEmitTaskEvent } from '../services/taskEventService.js';
import { agentActivityService } from '../services/agentActivityService.js';
import { WorkflowRunService } from '../services/workflowRunService.js';
import { runTraceProjectionForViewer } from '../services/runTracePure.js';
import type { PermissionMaskUserContext } from '../lib/agentRunEditPermissionMaskPure.js';

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

    if (!(await taskService.assertOrgOwnsTask(taskId, orgId))) {
      res.status(404).json({ error: 'task_not_found' });
      return;
    }

    const oldestRetainedSeq = await getOldestRetainedTaskSequence(taskId);

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

    // Spec REQ 11-extra — when a consumer-side gap is detected, emit
    // task.degraded so other connected clients are notified, and write
    // workflow_runs.degradation_reason once (first-write-wins via predicate).
    let activeRunId: string | null = null;
    if (hasGap) {
      activeRunId = await resolveActiveRunForTask(taskId, orgId);
      if (activeRunId) {
        await WorkflowRunService.markRunDegraded(activeRunId, orgId, 'consumer_gap_detected');
      }
      void appendAndEmitTaskEvent(
        { taskId, organisationId: orgId, subaccountId: null },
        'engine',
        {
          kind: 'task.degraded',
          payload: {
            reason: 'consumer_gap_detected',
            gapRange: oldestRetainedSeq !== null ? [fromSeq, oldestRetainedSeq] : undefined,
            degradationReason: `Replay cursor ${fromSeq} is before oldest retained event ${oldestRetainedSeq}`,
          },
        },
      );
    }

    // Route-layer viewer projection (spec §5.4 — second of two layers).
    // Fetch ownerUserId from the active run or from the first event's run.
    const runIdForProjection =
      activeRunId ?? (page.events.length > 0 ? page.events[0].runId : null);
    let routeOwnerUserId: string | null = null;
    if (runIdForProjection) {
      routeOwnerUserId = (await agentActivityService.getRunOwnerUserId(runIdForProjection, orgId)) ?? null;
    }
    const routeProjected = runTraceProjectionForViewer(user.id, {
      ownerUserId: routeOwnerUserId,
      events: page.events as unknown as import('../services/runTracePure.js').ProjectableEvent[],
    });

    res.json({
      events: routeProjected.events,
      hasGap,
      oldestRetainedSeq,
    });
  }),
);

export default router;
