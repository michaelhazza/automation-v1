/**
 * askFormAutoFillService.ts — finds the most recent prior submission for a
 * given template version + stepId and returns type-matched pre-fill values.
 *
 * Rule (spec §11, auto-fill): pre-fill only where BOTH key AND type match
 * the prior submission. Type change = schema evolution = no pre-fill for
 * that key.
 *
 * Spec: docs/workflows-dev-spec.md §11.
 */

import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflowRuns, workflowStepRuns } from '../db/schema/index.js';
import type { AskFormValues, AskFormFieldDef } from '../../../shared/types/askForm.js';
import { filterByKeyTypeMatch } from './askFormAutoFillServicePure.js';
import { logger } from '../lib/logger.js';

export const AskFormAutoFillService = {
  /**
   * Returns pre-fill values for the given step, filtered to key+type matches.
   * Returns {} when no prior submission exists.
   */
  async getAutoFill(
    templateVersionId: string,
    stepId: string,
    organisationId: string,
    currentFields: AskFormFieldDef[],
  ): Promise<AskFormValues> {
    try {
      // Find the most recent completed run for this template version + org
      const [priorRun] = await db
        .select({ id: workflowRuns.id })
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.templateVersionId, templateVersionId),
            eq(workflowRuns.organisationId, organisationId),
            eq(workflowRuns.status, 'completed'),
          ),
        )
        .orderBy(desc(workflowRuns.completedAt))
        .limit(1);

      if (!priorRun) return {};

      // Find the step run for this stepId in that run (not skipped)
      const [priorStepRun] = await db
        .select({ outputJson: workflowStepRuns.outputJson })
        .from(workflowStepRuns)
        .where(
          and(
            eq(workflowStepRuns.runId, priorRun.id),
            eq(workflowStepRuns.stepId, stepId),
            eq(workflowStepRuns.status, 'completed'),
            isNull(workflowStepRuns.error),
          ),
        )
        .limit(1);

      if (!priorStepRun?.outputJson) return {};

      const output = priorStepRun.outputJson as Record<string, unknown>;
      // Skipped steps have skipped: true — don't pre-fill from them
      if (output.skipped === true) return {};

      const priorValues = (output.values ?? {}) as AskFormValues;
      return filterByKeyTypeMatch(currentFields, priorValues);
    } catch (err) {
      logger.warn('ask_form_auto_fill_failed', {
        event: 'ask_form.auto_fill_failed',
        templateVersionId,
        stepId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {};
    }
  },
};
