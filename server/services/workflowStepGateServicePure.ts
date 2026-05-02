/**
 * workflowStepGateServicePure — pure helpers for gate snapshot construction.
 *
 * No DB imports. Safe to use in any context including tests.
 */

import type { SeenPayload, SeenConfidence } from '../../shared/types/workflowStepGate.js';
import { buildSeenPayload } from './workflowSeenPayloadServicePure.js';
import { computeConfidence, type ConfidenceInputs } from './workflowConfidenceServicePure.js';

/**
 * Build both seenPayload and seenConfidence from pure inputs.
 *
 * seenPayload and seenConfidence are snapshotted at gate-open and immutable thereafter.
 * When stepType is not in the payload taxonomy, seenPayload is null (caller stores null on the gate row).
 */
export function buildGateSnapshot(
  stepDefinition: { id: string; type: string; name: string; params?: Record<string, unknown> },
  confidenceInputs: ConfidenceInputs,
  agentReasoning?: string | null,
  branchDecision?: { field: string; resolved_value: unknown; target_step: string } | null
): { seenPayload: SeenPayload | null; seenConfidence: SeenConfidence } {
  const stepType = mapStepType(stepDefinition.type);

  const seenPayload = stepType
    ? buildSeenPayload({
        stepId: stepDefinition.id,
        stepType,
        stepName: stepDefinition.name,
        renderedInputs: stepDefinition.params ?? {},
        renderedPreview: null,
        agentReasoning: agentReasoning ?? null,
        branchDecision: branchDecision ?? null,
      })
    : null;

  const seenConfidence = computeConfidence(confidenceInputs);

  return { seenPayload, seenConfidence };
}

function mapStepType(type: string): 'agent' | 'action' | 'approval' | null {
  if (type === 'agent_call' || type === 'agent') return 'agent';
  if (type === 'action_call' || type === 'invoke_automation' || type === 'action') return 'action';
  if (type === 'approval') return 'approval';
  return null;
}
