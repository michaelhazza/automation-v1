/**
 * WorkflowConfidenceService — impure wrapper that loads aggregate data
 * then delegates to the pure computeConfidence heuristic.
 */

import { eq, and, count } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  workflowStepReviews,
  workflowStepGates,
  workflowRuns,
} from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { computeConfidence, type ConfidenceInputs } from './workflowConfidenceServicePure.js';
import { CONFIDENCE_COPY } from './workflowConfidenceCopyMap.js';
import type { SeenConfidence } from '../../shared/types/workflowStepGate.js';

export const WorkflowConfidenceService = {
  /**
   * Compute a SeenConfidence for a step gate.
   *
   * Loads past review counts and subaccount-first-use from the DB then
   * delegates to the pure heuristic. Falls back to medium on any DB error.
   */
  async computeForGate(
    templateVersionId: string,
    stepId: string,
    stepDefinition: { isCritical?: boolean; sideEffectType?: string; params?: Record<string, unknown> },
    runContext: { subaccountId: string | null },
    upstreamConfidence: 'high' | 'medium' | 'low' | null,
    organisationId: string
  ): Promise<SeenConfidence> {
    try {
      const db = getOrgScopedDb('workflowConfidenceService.computeForGate');

      // Aggregate past reviews for this (templateVersionId, stepId) via the
      // workflowStepGates → workflowRuns join path, since workflowStepReviews
      // does not carry templateVersionId / stepId directly.
      //
      // approved count: reviews where decision = 'approved'
      // rejected count: reviews where decision = 'rejected'
      const reviewRows = await db
        .select({
          decision: workflowStepReviews.decision,
          cnt: count(workflowStepReviews.id),
        })
        .from(workflowStepReviews)
        .innerJoin(workflowStepGates, eq(workflowStepReviews.gateId, workflowStepGates.id))
        .innerJoin(workflowRuns, eq(workflowStepGates.workflowRunId, workflowRuns.id))
        .where(
          and(
            eq(workflowRuns.templateVersionId, templateVersionId),
            eq(workflowStepGates.stepId, stepId),
            eq(workflowRuns.organisationId, organisationId)
          )
        )
        .groupBy(workflowStepReviews.decision);

      let approvedCount = 0;
      let rejectedCount = 0;
      for (const row of reviewRows) {
        if (row.decision === 'approved') approvedCount = Number(row.cnt);
        if (row.decision === 'rejected') rejectedCount = Number(row.cnt);
      }

      // Subaccount-first-use: no prior reviews for this subaccount + template + step
      let subaccountFirstUseFlag = false;
      if (runContext.subaccountId !== null) {
        const [subRow] = await db
          .select({ cnt: count(workflowStepReviews.id) })
          .from(workflowStepReviews)
          .innerJoin(workflowStepGates, eq(workflowStepReviews.gateId, workflowStepGates.id))
          .innerJoin(workflowRuns, eq(workflowStepGates.workflowRunId, workflowRuns.id))
          .where(
            and(
              eq(workflowRuns.subaccountId, runContext.subaccountId),
              eq(workflowRuns.templateVersionId, templateVersionId),
              eq(workflowStepGates.stepId, stepId),
              eq(workflowRuns.organisationId, organisationId)
            )
          );
        subaccountFirstUseFlag = Number(subRow?.cnt ?? 0) === 0;
      }

      const sideEffectRaw = stepDefinition.sideEffectType ?? null;
      const sideEffectClass: ConfidenceInputs['sideEffectClass'] =
        sideEffectRaw === 'irreversible' || sideEffectRaw === 'reversible' || sideEffectRaw === 'none'
          ? sideEffectRaw
          : null;

      const inputs: ConfidenceInputs = {
        templateVersionId,
        stepId,
        isCritical: stepDefinition.isCritical ?? false,
        sideEffectClass,
        pastReviewsCount: { approved: approvedCount, rejected: rejectedCount },
        subaccountFirstUseFlag,
        upstreamConfidence,
      };

      return computeConfidence(inputs);
    } catch (err) {
      logger.warn({ err }, 'workflowConfidenceService: aggregate query failed, falling back to medium');
      return {
        value: 'medium',
        reason: CONFIDENCE_COPY['few_past_runs_mixed'].reason,
        computed_at: new Date().toISOString(),
        signals: [],
      };
    }
  },
};
