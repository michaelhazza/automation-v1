export interface WorkflowRunStartInput {
  workflow_template_id: string;
  template_version_id?: string;
  initial_inputs: Record<string, unknown>;
}

export type WorkflowRunStartOutput =
  | { ok: true; task_id: string }
  | { ok: false; error: 'permission_denied' | 'template_not_found' | 'template_not_published' | 'inputs_invalid' | 'max_workflow_depth_exceeded'; message: string };
