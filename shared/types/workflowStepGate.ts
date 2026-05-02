export interface SeenPayload {
  step_id: string;
  step_type: 'agent' | 'action' | 'approval';
  step_name: string;
  rendered_inputs: Record<string, unknown>;
  rendered_preview: string | null;
  agent_reasoning: string | null;
  branch_decision: { field: string; resolved_value: unknown; target_step: string } | null;
}

export interface SeenConfidence {
  value: 'high' | 'medium' | 'low';
  reason: string;
  computed_at: string;
  signals: Array<{ name: string; weight: number }>;
}

export type ApproverPoolSnapshot = string[];

/**
 * Describes who should be in the approver pool for a step gate.
 * Consumed by WorkflowApproverPoolService.resolvePool at runtime.
 */
export interface ApproverGroup {
  kind: 'specific_users' | 'team' | 'task_requester' | 'org_admin';
  /** Populated when kind === 'specific_users' */
  userIds?: string[];
  /** Populated when kind === 'team' */
  teamId?: string;
}
