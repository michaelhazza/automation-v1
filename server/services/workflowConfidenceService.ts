/**
 * WorkflowConfidenceService — impure wrapper for the confidence heuristic.
 *
 * Spec: docs/workflows-dev-spec.md §6.1, §6.2, §6.4.
 *
 * Loads past-review aggregates + first-use signal from DB, delegates to the
 * pure module, and applies the §6.4 error fallback: any failure returns the
 * 'few_past_runs_mixed_history' default rather than propagating.
 */

import { eq, and, inArray, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflowRuns, workflowStepRuns, workflowStepReviews } from '../db/schema/index.js';
import type { SeenConfidence } from '../../shared/types/workflowStepGate.js';
import { computeConfidence } from './workflowConfidenceServicePure.js';
import { CONFIDENCE_COPY_MAP } from './workflowConfidenceCopyMap.js';
import { logger } from '../lib/logger.js';

export const WorkflowConfidenceService = {
  /**
   * Compute seen_confidence for a gate about to be opened.
   *
   * On any error: logs workflow_confidence_fallback and returns the
   * 'few_past_runs_mixed_history' default (§6.4 — confidence is decoration,
   * not authority; gate always opens regardless).
   */
  async computeForGate(params: {
    templateVersionId: string;
    stepId: string;
    stepDefinition: {
      isCritical?: boolean;
      sideEffectClass?: 'none' | 'idempotent' | 'reversible' | 'irreversible';
    };
    subaccountId: string | null;
    organisationId: string;
    upstreamConfidence: 'high' | 'medium' | 'low' | null;
  }): Promise<SeenConfidence> {
    const fallback: SeenConfidence = {
      value: CONFIDENCE_COPY_MAP.few_past_runs_mixed_history.value,
      reason: CONFIDENCE_COPY_MAP.few_past_runs_mixed_history.reason,
      computed_at: new Date().toISOString(),
      signals: [],
    };

    try {
      // Step 1: Count approved + rejected reviews for this (templateVersionId, stepId) pair.
      // Join path: workflow_step_reviews → workflow_step_runs → workflow_runs
      // Filter: step_id = stepId AND template_version_id = templateVersionId
      const stepRunRows = await db
        .select({ id: workflowStepRuns.id })
        .from(workflowStepRuns)
        .innerJoin(workflowRuns, eq(workflowStepRuns.runId, workflowRuns.id))
        .where(
          and(
            eq(workflowStepRuns.stepId, params.stepId),
            eq(workflowRuns.templateVersionId, params.templateVersionId),
            eq(workflowRuns.organisationId, params.organisationId),
          ),
        );

      let approvedCount = 0;
      let rejectedCount = 0;

      if (stepRunRows.length > 0) {
        const stepRunIds = stepRunRows.map((r) => r.id);

        const reviewRows = await db
          .select({ decision: workflowStepReviews.decision })
          .from(workflowStepReviews)
          .where(
            and(
              inArray(workflowStepReviews.stepRunId, stepRunIds),
              inArray(workflowStepReviews.decision, ['approved', 'rejected']),
            ),
          );

        for (const row of reviewRows) {
          if (row.decision === 'approved') approvedCount++;
          else if (row.decision === 'rejected') rejectedCount++;
        }
      }

      // Step 2: Subaccount first-use signal.
      let subaccountFirstUseFlag = false;
      if (params.subaccountId !== null) {
        const [countResult] = await db
          .select({ total: count() })
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.subaccountId, params.subaccountId),
              eq(workflowRuns.templateVersionId, params.templateVersionId),
              eq(workflowRuns.organisationId, params.organisationId),
            ),
          );
        subaccountFirstUseFlag = (countResult?.total ?? 0) === 0;
      }

      // Step 3: Call the pure module.
      const { confidence } = computeConfidence({
        stepDefinition: params.stepDefinition,
        pastReviewsCount: { approved: approvedCount, rejected: rejectedCount },
        subaccountFirstUseFlag,
        upstreamConfidence: params.upstreamConfidence,
      });

      return confidence;
    } catch (err) {
      logger.warn('workflow_confidence_fallback', {
        templateVersionId: params.templateVersionId,
        stepId: params.stepId,
        error: err instanceof Error ? err.message : String(err),
      });
      return fallback;
    }
  },
};
