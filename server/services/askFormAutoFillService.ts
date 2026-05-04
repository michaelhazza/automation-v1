/**
 * AskFormAutoFillService — pre-fill values from the last completed run.
 *
 * Spec: docs/workflows-dev-spec.md §11.5.
 *
 * Auto-fill rule: include a value only when the field key exists in the prior
 * run's output AND the current schema's field matches that key. Type matching
 * is key-present only in V1 — the client's validateAskForm enforces types.
 */

import { eq, and, lt, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflowRuns, workflowStepRuns } from '../db/schema/workflowRuns.js';
import { resolveActiveRunForTask } from './workflowRunResolverService.js';
import type { AskField } from '../../shared/types/askForm.js';

const COMPLETED_STATUS = 'completed';

export const askFormAutoFillService = {
  async getAutoFillValues(
    taskId: string,
    stepId: string,
    currentFields: AskField[],
    organisationId: string,
  ): Promise<Record<string, unknown>> {
    if (currentFields.length === 0) return {};

    // Get the current active run to find templateVersionId.
    const runId = await resolveActiveRunForTask(taskId, organisationId);
    if (!runId) return {};

    const [currentRun] = await db
      .select({ id: workflowRuns.id, templateVersionId: workflowRuns.templateVersionId, createdAt: workflowRuns.createdAt })
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.organisationId, organisationId)));
    if (!currentRun) return {};

    // Find the most recent prior completed run for the same template version.
    const [priorRun] = await db
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.organisationId, organisationId),
          eq(workflowRuns.templateVersionId, currentRun.templateVersionId),
          eq(workflowRuns.status, COMPLETED_STATUS),
          lt(workflowRuns.createdAt, currentRun.createdAt),
        ),
      )
      .orderBy(desc(workflowRuns.createdAt))
      .limit(1);

    if (!priorRun) return {};

    // Find the matching step run in the prior run.
    const [priorStepRun] = await db
      .select({ outputJson: workflowStepRuns.outputJson })
      .from(workflowStepRuns)
      .where(
        and(
          eq(workflowStepRuns.runId, priorRun.id),
          eq(workflowStepRuns.stepId, stepId),
          eq(workflowStepRuns.status, COMPLETED_STATUS),
        ),
      );

    if (!priorStepRun || !priorStepRun.outputJson) return {};

    const priorValues = (priorStepRun.outputJson as Record<string, unknown>).values;
    if (!priorValues || typeof priorValues !== 'object' || Array.isArray(priorValues)) return {};

    const typedPriorValues = priorValues as Record<string, unknown>;
    const currentFieldKeys = new Set(currentFields.map((f) => f.key));

    // Return only keys that exist in the current schema.
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(typedPriorValues)) {
      if (currentFieldKeys.has(key)) {
        result[key] = typedPriorValues[key];
      }
    }
    return result;
  },
};
