// Shared types for workflow step gates, drafts, and related structures.
// Spec: docs/workflows-dev-spec.md §3.

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

export type EventOrigin = 'engine' | 'gate' | 'user' | 'orchestrator';
export type GateKind = 'approval' | 'ask';
export type GateResolutionReason = 'approved' | 'rejected' | 'submitted' | 'skipped' | 'run_terminated';
export type DraftSource = 'orchestrator' | 'studio_handoff';

export interface WorkflowStepGate {
  id: string;
  workflowRunId: string;
  stepId: string;
  gateKind: GateKind;
  seenPayload: SeenPayload | null;
  seenConfidence: SeenConfidence | null;
  approverPoolSnapshot: ApproverPoolSnapshot | null;
  isCriticalSynthesised: boolean;
  createdAt: Date;
  resolvedAt: Date | null;
  resolutionReason: GateResolutionReason | null;
  supersededByGateId: string | null;
  organisationId: string;
}
