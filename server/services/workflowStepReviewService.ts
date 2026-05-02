/**
 * WorkflowStepReviewService — HITL approval gates for Workflow step runs.
 *
 * Sprint 4 P3.1: provides the `requireApproval(stepRun)` method used by
 * the supervised run mode. When a run is in `supervised` mode, every step
 * must pass through a review gate before being dispatched. This service
 * creates a `WorkflowStepGate` + `WorkflowStepReview` row and transitions
 * the step to `awaiting_approval` in a single transaction.
 */

import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  workflowStepRuns,
  workflowStepReviews,
  workflowRuns,
} from '../db/schema/index.js';
import type { WorkflowStepRun } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { emitWorkflowRunUpdate, emitSubaccountUpdate } from '../websocket/emitters.js';
import { assertValidTransition, InvalidTransitionError } from '../../shared/stateMachineGuards.js';
import { WorkflowStepGateService } from './workflowStepGateService.js';
import type { ApproverGroup } from '../../shared/types/workflowStepGate.js';
import { WorkflowApproverPoolService } from './workflowApproverPoolService.js';

export const WorkflowStepReviewService = {
  /**
   * Require human approval for a step run before it can be dispatched.
   * Used by the `supervised` run mode (Sprint 4 P3.1). Opens a gate,
   * creates a pending review row, and transitions the step to
   * `awaiting_approval` — all in a single transaction.
   *
   * Idempotent: if an open gate already exists for this (runId, stepId),
   * this is a no-op.
   *
   * When `approverGroup` is provided the pool is resolved via
   * WorkflowApproverPoolService and stored on the gate. When omitted the
   * gate has an open pool (everyone qualifies).
   *
   * When `isCriticalSynthesised` is true the gate was synthesised by the
   * engine because `step.params.is_critical === true` rather than being an
   * explicit Approval step in the template.
   */
  async requireApproval(
    stepRun: WorkflowStepRun,
    context?: {
      reviewKind?: string;
      approverGroup?: ApproverGroup;
      isCriticalSynthesised?: boolean;
    }
  ): Promise<void> {
    // Load the run outside the transaction to get organisationId for pool resolution.
    const [runForPool] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, stepRun.runId));
    if (!runForPool) {
      throw { statusCode: 404, message: 'Workflow run not found', errorCode: 'run_not_found' };
    }

    // Resolve the approver pool BEFORE opening the transaction.
    // resolvePool uses getOrgScopedDb internally (separate connection) and is
    // a read-only operation — it must not be nested inside a write transaction.
    let approverPoolSnapshot: string[] | null = null;
    if (context?.approverGroup) {
      // NOTE: spec §5.1 says 'tasks.created_by_user_id' but workflowRuns has no taskId
      // column. The `task_requester` resolver uses runContext.runId to look up
      // workflowRuns.startedByUserId, which is the closest semantic equivalent
      // (the human who started this run). taskId is not used by any other resolver.
      approverPoolSnapshot = await WorkflowApproverPoolService.resolvePool(
        context.approverGroup,
        { taskId: runForPool.id, runId: runForPool.id },
        runForPool.organisationId,
        runForPool.subaccountId ?? null
      );
    }

    await db.transaction(async (tx) => {
      // Re-load the run inside the transaction for consistent gate creation.
      const [run] = await tx
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, stepRun.runId));
      if (!run) {
        throw { statusCode: 404, message: 'Workflow run not found', errorCode: 'run_not_found' };
      }

      // Open (or retrieve existing) gate — idempotent.
      const gate = await WorkflowStepGateService.openGate(
        {
          workflowRunId: stepRun.runId,
          stepId: stepRun.stepId,
          gateKind: 'approval',
          approverPoolSnapshot,
          isCriticalSynthesised: context?.isCriticalSynthesised ?? false,
          organisationId: run.organisationId,
        },
        tx
      );

      // If the gate was already open (pre-existing), check for an existing
      // pending review — if found, the whole operation is idempotent.
      const existingReview = await tx
        .select()
        .from(workflowStepReviews)
        .where(
          and(
            eq(workflowStepReviews.stepRunId, stepRun.id),
            eq(workflowStepReviews.decision, 'pending')
          )
        );
      if (existingReview.length > 0) {
        logger.debug('workflow_step_review_already_pending', {
          stepRunId: stepRun.id,
          stepId: stepRun.stepId,
          gateId: gate.id,
        });
        return;
      }

      // Assert the step transition is valid before performing the UPDATE.
      try {
        assertValidTransition({
          kind: 'workflow_step_run',
          recordId: stepRun.id,
          from: stepRun.status,
          to: 'awaiting_approval',
        });
      } catch (err) {
        if (err instanceof InvalidTransitionError) {
          throw {
            statusCode: 409,
            message: 'Step is not in a valid state for approval',
            errorCode: 'invalid_step_transition',
            currentStatus: stepRun.status,
            attemptedStatus: 'awaiting_approval',
          };
        }
        throw err;
      }

      // Insert pending review row with gate linkage.
      await tx.insert(workflowStepReviews).values({
        stepRunId: stepRun.id,
        decision: 'pending',
        gateId: gate.id,
      });

      // Transition the step to awaiting_approval.
      await tx
        .update(workflowStepRuns)
        .set({
          status: 'awaiting_approval',
          startedAt: new Date(),
          version: stepRun.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(workflowStepRuns.id, stepRun.id));

      logger.info('workflow_step_review_required', {
        event: 'step.awaiting_approval',
        stepRunId: stepRun.id,
        stepId: stepRun.stepId,
        runId: stepRun.runId,
        gateId: gate.id,
        reviewKind: context?.reviewKind ?? 'supervised_mode',
        isCriticalSynthesised: context?.isCriticalSynthesised ?? false,
        approverGroupKind: context?.approverGroup?.kind ?? null,
      });
    });

    // Emit WS events outside the transaction (best-effort).
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, stepRun.runId));

    if (run) {
      emitWorkflowRunUpdate(run.id, 'Workflow:step:awaiting_approval', {
        stepRunId: stepRun.id,
        stepId: stepRun.stepId,
        reviewKind: context?.reviewKind ?? 'supervised_mode',
      });
      // Org-scope runs (migration 0171) have no subaccount room to emit into.
      if (run.subaccountId !== null) {
        emitSubaccountUpdate(run.subaccountId, 'Workflow:step:awaiting_approval', {
          runId: run.id,
          stepRunId: stepRun.id,
          stepId: stepRun.stepId,
        });
      }
    }
  },
};
