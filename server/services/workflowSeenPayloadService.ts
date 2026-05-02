/**
 * WorkflowSeenPayloadService — impure orchestrator that builds a SeenPayload
 * snapshot with run-context loading.
 *
 * V1: rendered_preview is not computed. Input binding resolution is deferred
 * to Chunk 11+. params are passed through as-is.
 */

import { logger } from '../lib/logger.js';
import { buildSeenPayload } from './workflowSeenPayloadServicePure.js';
import type { SeenPayload } from '../../shared/types/workflowStepGate.js';

export const WorkflowSeenPayloadService = {
  /**
   * Build a SeenPayload for a gate opening. Returns null if the step type
   * is not in the payload taxonomy or on any error.
   */
  async buildForGate(
    stepDefinition: { id: string; type: string; name: string; params?: Record<string, unknown> },
    runContext: { contextJson: unknown },
    agentReasoning?: string | null,
    branchDecision?: { field: string; resolved_value: unknown; target_step: string } | null
  ): Promise<SeenPayload | null> {
    try {
      const stepType = mapEngineTypeToSeenPayloadType(stepDefinition.type);
      if (!stepType) return null; // step type not in payload taxonomy

      return buildSeenPayload({
        stepId: stepDefinition.id,
        stepType,
        stepName: stepDefinition.name,
        renderedInputs: resolveInputsFromContext(stepDefinition.params, runContext.contextJson),
        renderedPreview: null, // V1: no rendered preview computation
        agentReasoning,
        branchDecision,
      });
    } catch (err) {
      logger.warn({ err }, 'workflowSeenPayloadService: seen_payload build failed');
      return null;
    }
  },
};

function mapEngineTypeToSeenPayloadType(type: string): 'agent' | 'action' | 'approval' | null {
  if (type === 'agent_call' || type === 'agent') return 'agent';
  if (type === 'action_call' || type === 'invoke_automation' || type === 'action') return 'action';
  if (type === 'approval') return 'approval';
  return null;
}

function resolveInputsFromContext(
  params: Record<string, unknown> | undefined,
  _contextJson: unknown
): Record<string, unknown> {
  // V1: return params as-is (binding resolution is Chunk 11+ work)
  return params ?? {};
}
