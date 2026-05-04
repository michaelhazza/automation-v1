import { WorkflowTemplateService } from './workflowTemplateService.js';
import { WorkflowRunService } from './workflowRunService.js';
import { taskService } from './taskService.js';
import type { SkillExecutionContext } from './skillExecutor.js';
import type { WorkflowRunStartOutput } from '../../shared/types/workflowRunStartSkill.js';

export const MAX_WORKFLOW_DEPTH = 3;

export class MissingWorkflowDepthError extends Error {
  constructor() {
    super('workflowRunDepth missing from context — propagation bug');
    this.name = 'MissingWorkflowDepthError';
  }
}

export class InvalidWorkflowDepthError extends Error {
  constructor(depth: number) {
    super(`workflowRunDepth ${depth} is invalid (must be >= 1)`);
    this.name = 'InvalidWorkflowDepthError';
  }
}

export async function handleWorkflowRunStartSkill(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<WorkflowRunStartOutput> {
  // 1. Depth entry guard
  if (context.workflowRunDepth == null) throw new MissingWorkflowDepthError();
  if (context.workflowRunDepth < 1) throw new InvalidWorkflowDepthError(context.workflowRunDepth);

  const newDepth = context.workflowRunDepth + 1;
  if (newDepth > MAX_WORKFLOW_DEPTH) {
    return { ok: false, error: 'max_workflow_depth_exceeded', message: `Workflow depth limit (${MAX_WORKFLOW_DEPTH}) exceeded` };
  }

  // 2. Validate input shape
  const { workflow_template_id, template_version_id, initial_inputs } = input as {
    workflow_template_id?: unknown;
    template_version_id?: unknown;
    initial_inputs?: unknown;
  };

  if (typeof workflow_template_id !== 'string' || !workflow_template_id) {
    return { ok: false, error: 'inputs_invalid', message: 'workflow_template_id is required' };
  }

  // 3. Validate template exists and is published
  const template = await WorkflowTemplateService.getOrgTemplate(context.organisationId, workflow_template_id);
  if (!template) return { ok: false, error: 'template_not_found', message: 'Workflow template not found' };
  if (template.latestVersion === 0) return { ok: false, error: 'template_not_published', message: 'Workflow template has no published version' };

  // 4. Validate subaccount context
  if (!context.subaccountId) {
    return { ok: false, error: 'permission_denied', message: 'No subaccount context — cannot start workflow' };
  }

  // 5. Create a task for the run
  const task = await taskService.createTask(
    context.organisationId,
    context.subaccountId,
    {
      title: `Workflow run: ${template.name}`,
      description: `Workflow run: ${template.name}`,
      createdByAgentId: context.agentId,
      isSubTask: true,
    },
  );

  // 6. Start the workflow run
  await WorkflowRunService.startRun({
    organisationId: context.organisationId,
    subaccountId: context.subaccountId,
    templateId: workflow_template_id,
    pinnedTemplateVersionId: typeof template_version_id === 'string' ? template_version_id : null,
    initialInput: (typeof initial_inputs === 'object' && initial_inputs !== null ? initial_inputs : {}) as Record<string, unknown>,
    startedByUserId: context.userId ?? undefined,
    taskId: task.id,
    workflowRunDepth: newDepth,
  });

  return { ok: true, task_id: task.id };
}
