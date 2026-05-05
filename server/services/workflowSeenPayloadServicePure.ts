/**
 * workflowSeenPayloadServicePure — pure builder for SeenPayload.
 *
 * Spec: docs/workflows-dev-spec.md §6.3.
 *
 * No DB. No I/O.
 */

import type { SeenPayload } from '../../shared/types/workflowStepGate.js';

export interface SeenPayloadInput {
  stepDefinition: {
    id: string;
    type: string;
    name?: string;
    params?: Record<string, unknown>;
  };
  agentReasoning?: string | null;
  branchDecision?: { field: string; resolvedValue: unknown; targetStep: string } | null;
}

/**
 * Map a raw step type string to the SeenPayload step_type enum.
 *
 * V1 user-facing names ('agent', 'action', 'approval') are passthrough.
 * Engine / legacy aliases are normalised. Unknowns fall back to 'agent'.
 */
function mapStepType(rawType: string): SeenPayload['step_type'] {
  switch (rawType) {
    case 'agent':
    case 'agent_call':
    case 'prompt':
      return 'agent';
    case 'action':
    case 'action_call':
    case 'invoke_automation':
      return 'action';
    case 'approval':
      return 'approval';
    default:
      return 'agent';
  }
}

/**
 * Build the SeenPayload snapshot for a gate at open time.
 *
 * rendered_preview is always null in V1 (template rendering is V2 scope).
 */
export function buildSeenPayload(input: SeenPayloadInput): SeenPayload {
  const { stepDefinition, agentReasoning, branchDecision } = input;

  return {
    step_id: stepDefinition.id,
    step_type: mapStepType(stepDefinition.type),
    step_name: stepDefinition.name ?? stepDefinition.id,
    rendered_inputs: stepDefinition.params ?? {},
    rendered_preview: null,
    agent_reasoning: agentReasoning ?? null,
    branch_decision: branchDecision
      ? {
          field: branchDecision.field,
          resolved_value: branchDecision.resolvedValue,
          target_step: branchDecision.targetStep,
        }
      : null,
  };
}
