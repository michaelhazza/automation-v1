/**
 * WorkflowStepReviewService — HITL approval gates for Workflow step runs.
 *
 * Sprint 4 P3.1: provides the `requireApproval(stepRun)` method used by
 * the supervised run mode. When a run is in `supervised` mode, every step
 * must pass through a review gate before being dispatched. This service
 * creates a `WorkflowStepReview` row and transitions the step to
 * `awaiting_approval`, reusing the existing approval infrastructure.
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
import { assertValidTransition } from '../../shared/stateMachineGuards.js';
import { WorkflowStepGateService } from './workflowStepGateService.js';
import { WorkflowApproverPoolService } from './workflowApproverPoolService.js';
import type { ApproverGroup } from '../../shared/types/workflowApproverGroup.js';

export const WorkflowStepReviewService = {
  /**
   * Require human approval for a step run before it can be dispatched.
   * Used by the `supervised` run mode (Sprint 4 P3.1). Creates a pending
   * review row and transitions the step to `awaiting_approval`.
   *
   * If a pending review already exists for this step run, this is a no-op
   * (idempotent).
   */
  async requireApproval(
    stepRun: WorkflowStepRun,
    context?: {
      reviewKind?: string;
      organisationId?: string;
      approverGroup?: ApproverGroup;
      isCriticalSynthesised?: boolean;
      // B1 fix (spec §6.3 audit invariant): forward gate-snapshot inputs
      // through to openGate so seen_payload and seen_confidence are computed
      // and persisted at gate-open. Optional — when absent, openGate falls
      // back to NULL snapshots and emits a warn log.
      stepDefinition?: {
        id: string;
        type: string;
        name?: string;
        params?: Record<string, unknown>;
        isCritical?: boolean;
        sideEffectClass?: string;
      };
      templateVersionId?: string;
      subaccountId?: string | null;
      agentReasoning?: string | null;
      branchDecision?: { field: string; resolvedValue: unknown; targetStep: string } | null;
      upstreamConfidence?: 'high' | 'medium' | 'low' | null;
    }
  ): Promise<void> {
    // Idempotency: check if a pending review already exists (outside transaction)
    const existing = await db
      .select()
      .from(workflowStepReviews)
      .where(
        and(
          eq(workflowStepReviews.stepRunId, stepRun.id),
          eq(workflowStepReviews.decision, 'pending')
        )
      );
    if (existing.length > 0) {
      logger.debug('workflow_step_review_already_pending', {
        stepRunId: stepRun.id,
        stepId: stepRun.stepId,
      });
      return;
    }

    // Pre-existing violation #2 fix (spec §18.1): assert the transition is valid
    // before writing awaiting_approval to the step run.
    assertValidTransition({
      kind: 'workflow_step_run',
      recordId: stepRun.id,
      from: stepRun.status,
      to: 'awaiting_approval',
    });

    // Load the run to resolve organisationId for gate operations
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, stepRun.runId));

    const organisationId = context?.organisationId ?? run?.organisationId;

    if (!organisationId) {
      logger.warn('workflow_step_review_gate_skipped_no_org', {
        stepRunId: stepRun.id,
        reason: 'organisationId_not_resolvable',
      });
    }

    await db.transaction(async (tx) => {
      // Open (or re-use) the gate for this step
      let gateId: string | undefined;
      if (organisationId) {
        const gate = await WorkflowStepGateService.openGate(
          {
            workflowRunId: stepRun.runId,
            stepId: stepRun.stepId,
            gateKind: 'approval',
            isCriticalSynthesised: context?.isCriticalSynthesised ?? false,
            organisationId,
            requesterUserId: run?.startedByUserId ?? undefined,
            // B1 fix (spec §6.3): forward gate-snapshot inputs so seen_payload
            // and seen_confidence are computed at gate-open. Caller-supplied
            // values win over run-derived defaults.
            stepDefinition: context?.stepDefinition,
            templateVersionId: context?.templateVersionId ?? run?.templateVersionId,
            subaccountId: context?.subaccountId ?? run?.subaccountId ?? null,
            agentReasoning: context?.agentReasoning ?? null,
            branchDecision: context?.branchDecision ?? null,
            upstreamConfidence: context?.upstreamConfidence ?? null,
          },
          tx,
        );
        gateId = gate.id;

        // Resolve approver pool if group is provided and gate was freshly opened
        // (not an idempotency hit — idempotency hit returns existing gate which
        // may already have a pool snapshot; we skip re-resolution to honour
        // snapshot immutability).
        if (context?.approverGroup && run) {
          const runContext = {
            runId: stepRun.runId,
            organisationId,
            subaccountId: run.subaccountId,
          };
          try {
            const pool = await WorkflowApproverPoolService.resolvePool(
              context.approverGroup,
              runContext,
              tx,
            );
            await WorkflowStepGateService.refreshPool(gateId, organisationId, pool, tx);
          } catch (err) {
            logger.warn('workflow_step_review_pool_resolution_failed', {
              stepRunId: stepRun.id,
              gateId,
              error: err instanceof Error ? err.message : String(err),
            });
            if (context?.isCriticalSynthesised) {
              throw err; // Synthesised critical gate must have a pool; fail closed
            }
            // Non-critical gates: gate proceeds without pool restriction (admin can /refresh-pool)
          }
        }
      }

      // Create a pending review row (with gate association if available)
      await tx.insert(workflowStepReviews).values({
        stepRunId: stepRun.id,
        decision: 'pending',
        ...(gateId ? { gateId } : {}),
      });

      // Transition the step to awaiting_approval
      await tx
        .update(workflowStepRuns)
        .set({
          status: 'awaiting_approval',
          startedAt: new Date(),
          version: stepRun.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(workflowStepRuns.id, stepRun.id));
    });

    logger.info('workflow_step_review_required', {
      event: 'step.awaiting_approval',
      stepRunId: stepRun.id,
      stepId: stepRun.stepId,
      runId: stepRun.runId,
      reviewKind: context?.reviewKind ?? 'supervised_mode',
    });

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
