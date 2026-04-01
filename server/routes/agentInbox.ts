// ---------------------------------------------------------------------------
// Agent Inbox — pending_approval actions with workflow context.
//
// Extends the existing review queue with workflow run details so the UI
// can render the full workflow context panel alongside the action card.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { eq, and, inArray } from 'drizzle-orm';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { db } from '../db/index.js';
import { actions } from '../db/schema/actions.js';
import { workflowRuns } from '../db/schema/workflowRuns.js';

const router = Router();

// ─── GET /api/subaccounts/:subaccountId/agent-inbox ──────────────────────────
//
// Returns all pending_approval actions for this subaccount, enriched with
// workflow run context when the action was triggered from a workflow step.

router.get(
  '/api/subaccounts/:subaccountId/agent-inbox',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_VIEW),
  async (req, res) => {
    try {
      const { subaccountId } = req.params;
      const organisationId = req.orgId!;

      // Fetch pending_approval actions for this subaccount
      const pendingActions = await db
        .select()
        .from(actions)
        .where(
          and(
            eq(actions.subaccountId, subaccountId),
            eq(actions.organisationId, organisationId),
            eq(actions.status, 'pending_approval'),
          ),
        )
        .orderBy(actions.createdAt);

      if (pendingActions.length === 0) {
        res.json([]);
        return;
      }

      // Collect unique workflow run IDs referenced by these actions
      const workflowRunIds = [
        ...new Set(
          pendingActions
            .map((a) => {
              const p = a.payload as Record<string, unknown> | null;
              return (p?.workflowRunId as string | undefined) ?? null;
            })
            .filter((id): id is string => id !== null),
        ),
      ];

      // Fetch workflow runs in bulk (if any)
      const workflowRunsMap = new Map<string, typeof workflowRuns.$inferSelect>();
      if (workflowRunIds.length > 0) {
        const runs = await db
          .select()
          .from(workflowRuns)
          .where(
            and(
              inArray(workflowRuns.id, workflowRunIds),
              eq(workflowRuns.organisationId, organisationId),
            ),
          );
        for (const run of runs) {
          workflowRunsMap.set(run.id, run);
        }
      }

      // Enrich each action with workflow context
      const enriched = pendingActions.map((action) => {
        const p = action.payload as Record<string, unknown> | null;
        const workflowRunId = (p?.workflowRunId as string | undefined) ?? null;
        const workflowStepId = (p?.workflowStepId as string | undefined) ?? null;
        const workflowRun = workflowRunId ? workflowRunsMap.get(workflowRunId) ?? null : null;

        return {
          ...action,
          workflowContext: workflowRun
            ? {
                workflowRunId,
                workflowStepId,
                workflowType: (workflowRun.workflowDefinition as { workflowType?: string }).workflowType,
                label: (workflowRun.workflowDefinition as { label?: string }).label ?? null,
                currentStepIndex: workflowRun.currentStepIndex,
                totalSteps: (workflowRun.workflowDefinition as { steps?: unknown[] }).steps?.length ?? 0,
                workflowStatus: workflowRun.status,
              }
            : null,
        };
      });

      res.json(enriched);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  },
);

export default router;
