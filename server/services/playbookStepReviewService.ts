/**
 * playbookStepReviewService — HITL approval gates for playbook step runs.
 *
 * Sprint 4 P3.1: provides the `requireApproval(stepRun)` method used by
 * the supervised run mode. When a run is in `supervised` mode, every step
 * must pass through a review gate before being dispatched. This service
 * creates a `playbookStepReview` row and transitions the step to
 * `awaiting_approval`, reusing the existing approval infrastructure.
 */

import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  playbookStepRuns,
  playbookStepReviews,
  playbookRuns,
} from '../db/schema/index.js';
import type { PlaybookStepRun } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { emitPlaybookRunUpdate, emitSubaccountUpdate } from '../websocket/emitters.js';

export const playbookStepReviewService = {
  /**
   * Require human approval for a step run before it can be dispatched.
   * Used by the `supervised` run mode (Sprint 4 P3.1). Creates a pending
   * review row and transitions the step to `awaiting_approval`.
   *
   * If a pending review already exists for this step run, this is a no-op
   * (idempotent).
   */
  async requireApproval(
    stepRun: PlaybookStepRun,
    context?: { reviewKind?: string }
  ): Promise<void> {
    // Idempotency: check if a pending review already exists
    const existing = await db
      .select()
      .from(playbookStepReviews)
      .where(
        and(
          eq(playbookStepReviews.stepRunId, stepRun.id),
          eq(playbookStepReviews.decision, 'pending')
        )
      );
    if (existing.length > 0) {
      logger.debug('playbook_step_review_already_pending', {
        stepRunId: stepRun.id,
        stepId: stepRun.stepId,
      });
      return;
    }

    // Create a pending review row
    await db.insert(playbookStepReviews).values({
      stepRunId: stepRun.id,
      decision: 'pending',
    });

    // Transition the step to awaiting_approval
    await db
      .update(playbookStepRuns)
      .set({
        status: 'awaiting_approval',
        startedAt: new Date(),
        version: stepRun.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(playbookStepRuns.id, stepRun.id));

    logger.info('playbook_step_review_required', {
      event: 'step.awaiting_approval',
      stepRunId: stepRun.id,
      stepId: stepRun.stepId,
      runId: stepRun.runId,
      reviewKind: context?.reviewKind ?? 'supervised_mode',
    });

    // Load the run to get the subaccountId for WS events
    const [run] = await db
      .select()
      .from(playbookRuns)
      .where(eq(playbookRuns.id, stepRun.runId));

    if (run) {
      emitPlaybookRunUpdate(run.id, 'playbook:step:awaiting_approval', {
        stepRunId: stepRun.id,
        stepId: stepRun.stepId,
        reviewKind: context?.reviewKind ?? 'supervised_mode',
      });
      // Org-scope runs (migration 0171) have no subaccount room to emit into.
      if (run.subaccountId !== null) {
        emitSubaccountUpdate(run.subaccountId, 'playbook:step:awaiting_approval', {
          runId: run.id,
          stepRunId: stepRun.id,
          stepId: stepRun.stepId,
        });
      }
    }
  },
};
