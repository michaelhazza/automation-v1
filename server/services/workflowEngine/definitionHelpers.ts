import { eq, and, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  workflowRuns,
  workflowStepRuns,
  workflowTemplates,
  workflowTemplateVersions,
  systemWorkflowTemplates,
  systemWorkflowTemplateVersions,
} from '../../db/schema/index.js';
import type { WorkflowRun, WorkflowStepRun, WorkflowDefinition, WorkflowStep } from './types.js';

export function rehydrateDefinition(stored: Record<string, unknown>): WorkflowDefinition {
  return stored as unknown as WorkflowDefinition;
}

export async function loadDefinitionForRun(run: WorkflowRun): Promise<WorkflowDefinition | null> {
  const [orgVer] = await db
    .select()
    .from(workflowTemplateVersions)
    .where(eq(workflowTemplateVersions.id, run.templateVersionId));
  if (orgVer) return rehydrateDefinition(orgVer.definitionJson as Record<string, unknown>);

  const [sysVer] = await db
    .select()
    .from(systemWorkflowTemplateVersions)
    .where(eq(systemWorkflowTemplateVersions.id, run.templateVersionId));
  if (sysVer) return rehydrateDefinition(sysVer.definitionJson as Record<string, unknown>);

  return null;
}

export function findStepInDefinition(def: WorkflowDefinition, stepId: string): WorkflowStep | undefined {
  return def.steps.find((s) => s.id === stepId);
}

/**
 * Look up the Workflow slug for a run by joining through either the org
 * template-version lineage or the system template-version lineage. Returns
 * null if neither side resolves.
 */
export async function resolveWorkflowSlugForRun(run: WorkflowRun): Promise<string | null> {
  const [orgRow] = await db
    .select({ slug: workflowTemplates.slug })
    .from(workflowTemplateVersions)
    .innerJoin(workflowTemplates, eq(workflowTemplateVersions.templateId, workflowTemplates.id))
    .where(eq(workflowTemplateVersions.id, run.templateVersionId));
  if (orgRow?.slug) return orgRow.slug;

  const [sysRow] = await db
    .select({ slug: systemWorkflowTemplates.slug })
    .from(systemWorkflowTemplateVersions)
    .innerJoin(
      systemWorkflowTemplates,
      eq(systemWorkflowTemplateVersions.systemTemplateId, systemWorkflowTemplates.id),
    )
    .where(eq(systemWorkflowTemplateVersions.id, run.templateVersionId));
  return sysRow?.slug ?? null;
}

/**
 * True iff a prior successful run of the same Workflow slug has already landed
 * on this sub-account. Drives the `firstRunOnly` gate on a `knowledgeBinding`.
 */
export async function hasPriorSuccessfulRunForSlug(
  subaccountId: string | null,
  slug: string,
  excludeRunId: string,
): Promise<boolean> {
  if (subaccountId === null) return false;
  const [orgHit] = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .innerJoin(
      workflowTemplateVersions,
      eq(workflowRuns.templateVersionId, workflowTemplateVersions.id),
    )
    .innerJoin(workflowTemplates, eq(workflowTemplateVersions.templateId, workflowTemplates.id))
    .where(
      and(
        eq(workflowRuns.subaccountId, subaccountId),
        eq(workflowTemplates.slug, slug),
        inArray(workflowRuns.status, ['completed', 'completed_with_errors']),
        ne(workflowRuns.id, excludeRunId),
      ),
    )
    .limit(1);
  if (orgHit) return true;

  const [sysHit] = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .innerJoin(
      systemWorkflowTemplateVersions,
      eq(workflowRuns.templateVersionId, systemWorkflowTemplateVersions.id),
    )
    .innerJoin(
      systemWorkflowTemplates,
      eq(systemWorkflowTemplateVersions.systemTemplateId, systemWorkflowTemplates.id),
    )
    .where(
      and(
        eq(workflowRuns.subaccountId, subaccountId),
        eq(systemWorkflowTemplates.slug, slug),
        inArray(workflowRuns.status, ['completed', 'completed_with_errors']),
        ne(workflowRuns.id, excludeRunId),
      ),
    )
    .limit(1);
  return !!sysHit;
}

/**
 * Creates pending step runs for a new Workflow run. Only creates entry steps
 * (dependsOn === []) — subsequent steps are created by the engine as dependencies complete.
 */
export async function createStepRunsForNewRun(
  runId: string,
  definition: WorkflowDefinition,
): Promise<void> {
  const entries = definition.steps.filter((s) => s.dependsOn.length === 0);
  for (const step of entries) {
    await db.insert(workflowStepRuns).values({
      runId,
      stepId: step.id,
      stepType: step.type,
      status: 'pending',
      sideEffectType: step.sideEffectType,
      dependsOn: step.dependsOn,
    });
  }
  // WS event sequence row
  await db.execute(
    sql`INSERT INTO workflow_run_event_sequences (run_id, last_sequence) VALUES (${runId}, 0) ON CONFLICT DO NOTHING`,
  );
}
