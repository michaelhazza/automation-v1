/**
 * workflowRunStartSkillService.ts — handler for the workflow.run.start skill.
 *
 * Validates the caller's permissions, resolves the template version, validates
 * initial inputs, creates a task, and delegates to WorkflowRunService.startRun.
 *
 * Spec: docs/workflows-dev-spec.md §13 (workflow.run.start skill)
 */

import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflowTemplates, workflowTemplateVersions, subaccountUserAssignments, permissionSetItems } from '../db/schema/index.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { taskService } from './taskService.js';
import { WorkflowRunService } from './workflowRunService.js';
import { decideWorkflowRunStartOutcome } from './workflowRunStartSkillServicePure.js';
import type { WorkflowRunStartOutput } from './workflowRunStartSkillServicePure.js';
import { logger } from '../lib/logger.js';

export type { WorkflowRunStartOutput };

// ─── Public types ─────────────────────────────────────────────────────────────

export interface WorkflowRunStartInput {
  workflow_template_id: string;
  template_version_id?: string;
  initial_inputs: Record<string, unknown>;
}

// ─── Permission helper ────────────────────────────────────────────────────────

/**
 * Programmatic subaccount permission check — mirrors the middleware version
 * but is usable in service context (no req/res).
 *
 * Returns true for system-level callers (empty userId treated as system user).
 */
async function callerHasSubaccountPermission(
  callerUserId: string,
  callerSubaccountId: string,
  permissionKey: string,
): Promise<boolean> {
  // Treat an empty user ID as a system caller — grant permission so
  // orchestrator-initiated runs are not blocked.
  if (!callerUserId) return true;

  const rows = await db
    .select({ permissionKey: permissionSetItems.permissionKey })
    .from(subaccountUserAssignments)
    .innerJoin(
      permissionSetItems,
      eq(permissionSetItems.permissionSetId, subaccountUserAssignments.permissionSetId),
    )
    .where(
      and(
        eq(subaccountUserAssignments.userId, callerUserId),
        eq(subaccountUserAssignments.subaccountId, callerSubaccountId),
      ),
    );

  return rows.some((r) => r.permissionKey === permissionKey);
}

// ─── Input validation helper ──────────────────────────────────────────────────

/**
 * Validate that all required fields declared in the template's input schema
 * are present in initial_inputs.
 *
 * Uses a permissive check — only validates required key presence (not deep
 * type validation), matching the V1 spec note that the engine validates fully
 * at run time.
 */
function validateInitialInputs(
  initialInputs: Record<string, unknown>,
  definitionJson: Record<string, unknown>,
): boolean {
  // If the template defines an input schema, check required fields.
  const inputSchema = definitionJson['inputSchema'] as Record<string, unknown> | undefined;
  if (!inputSchema) return true; // No schema declared — any inputs accepted.

  const required = inputSchema['required'];
  if (!Array.isArray(required)) return true;

  for (const key of required) {
    if (typeof key !== 'string') continue;
    if (!(key in initialInputs)) return false;
  }
  return true;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Execute the workflow.run.start skill.
 *
 * Resolves the template + version, checks permissions, validates inputs, and
 * creates a task + workflow run.
 */
export async function startWorkflowRunFromSkill(input: {
  skill: WorkflowRunStartInput;
  callerUserId: string;
  callerOrganisationId: string;
  callerSubaccountId: string;
}): Promise<WorkflowRunStartOutput> {
  const { skill, callerUserId, callerOrganisationId, callerSubaccountId } = input;

  // 1. Load the template — must exist, belong to the caller's org, not deleted.
  const [template] = await db
    .select()
    .from(workflowTemplates)
    .where(
      and(
        eq(workflowTemplates.id, skill.workflow_template_id),
        isNull(workflowTemplates.deletedAt),
      ),
    )
    .limit(1);

  const templateExists = template !== undefined;
  const templateOrgMatch = templateExists && template.organisationId === callerOrganisationId;

  // 2. Check caller permission on the subaccount.
  const callerHasPermission = await callerHasSubaccountPermission(
    callerUserId,
    callerSubaccountId,
    SUBACCOUNT_PERMISSIONS.WORKFLOW_RUNS_START,
  );

  // 3. Resolve the version.
  let versionResolved = false;
  let resolvedVersionId: string | undefined;
  let resolvedDefinitionJson: Record<string, unknown> | undefined;

  if (templateExists && templateOrgMatch) {
    if (skill.template_version_id) {
      // Use the pinned version if it exists and belongs to this template.
      const [pinnedVersion] = await db
        .select()
        .from(workflowTemplateVersions)
        .where(
          and(
            eq(workflowTemplateVersions.id, skill.template_version_id),
            eq(workflowTemplateVersions.templateId, skill.workflow_template_id),
          ),
        )
        .limit(1);
      if (pinnedVersion) {
        versionResolved = true;
        resolvedVersionId = pinnedVersion.id;
        resolvedDefinitionJson = pinnedVersion.definitionJson as Record<string, unknown>;
      }
    } else {
      // Use the latest published version.
      const [latestVersion] = await db
        .select()
        .from(workflowTemplateVersions)
        .where(eq(workflowTemplateVersions.templateId, skill.workflow_template_id))
        .orderBy(desc(workflowTemplateVersions.version))
        .limit(1);
      if (latestVersion) {
        versionResolved = true;
        resolvedVersionId = latestVersion.id;
        resolvedDefinitionJson = latestVersion.definitionJson as Record<string, unknown>;
      }
    }
  }

  // 4. Validate inputs (only when we have a definition to validate against).
  const inputsValid = resolvedDefinitionJson
    ? validateInitialInputs(skill.initial_inputs, resolvedDefinitionJson)
    : true; // Can't validate without definition; pre-condition check handles this.

  // 5. Run the pure pre-condition check.
  const precondition = decideWorkflowRunStartOutcome({
    templateExists,
    templateOrgMatch,
    versionResolved,
    callerHasPermission,
    inputsValid,
  });

  if (precondition.ok !== 'proceed') {
    return precondition;
  }

  // 6. Create a task row for this workflow run.
  let taskId: string;
  try {
    const task = await taskService.createTask(
      callerOrganisationId,
      callerSubaccountId,
      {
        title: `Workflow: ${template!.name}`,
        description: `Workflow run started via workflow.run.start skill`,
        status: 'doing',
      },
      callerUserId || undefined,
    );
    taskId = task.id;
  } catch (err) {
    logger.error('workflowRunStartSkill.createTask_failed', {
      workflow_template_id: skill.workflow_template_id,
      callerOrganisationId,
      callerSubaccountId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  // 7. Start the workflow run.
  const { runId } = await WorkflowRunService.startRun({
    organisationId: callerOrganisationId,
    subaccountId: callerSubaccountId,
    templateId: skill.workflow_template_id,
    initialInput: skill.initial_inputs,
    startedByUserId: callerUserId,
    pinnedTemplateVersionId: resolvedVersionId!,
    taskId,
  });

  return { ok: true, task_id: taskId, run_id: runId };
}
