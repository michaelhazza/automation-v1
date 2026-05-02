/**
 * workflowSeenPayloadServicePure — pure builder for SeenPayload snapshots.
 *
 * No DB calls. Safe to use in tests and any context.
 */

import type { SeenPayload } from '../../shared/types/workflowStepGate.js';

export interface SeenPayloadInputs {
  stepId: string;
  stepType: 'agent' | 'action' | 'approval';
  stepName: string;
  renderedInputs?: Record<string, unknown>;
  renderedPreview?: string | null;
  agentReasoning?: string | null;
  branchDecision?: { field: string; resolved_value: unknown; target_step: string } | null;
}

/**
 * Build a SeenPayload from structured inputs.
 * All optional fields default to safe empty/null values.
 */
export function buildSeenPayload(inputs: SeenPayloadInputs): SeenPayload {
  return {
    step_id: inputs.stepId,
    step_type: inputs.stepType,
    step_name: inputs.stepName,
    rendered_inputs: inputs.renderedInputs ?? {},
    rendered_preview: inputs.renderedPreview ?? null,
    agent_reasoning: inputs.agentReasoning ?? null,
    branch_decision: inputs.branchDecision ?? null,
  };
}
