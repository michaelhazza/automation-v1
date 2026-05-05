/**
 * workflowStepGateServicePure — pure helpers for gate snapshot construction.
 *
 * No DB, no I/O. Delegates seenPayload construction to
 * workflowSeenPayloadServicePure. The seenConfidence computation is async
 * (needs DB), so the impure caller (workflowStepGateService.ts → openGate)
 * calls WorkflowConfidenceService.computeForGate separately.
 */

import type { SeenPayload } from '../../shared/types/workflowStepGate.js';
import { buildSeenPayload } from './workflowSeenPayloadServicePure.js';

/**
 * Build the initial seen_payload snapshot for a gate.
 *
 * Returns { seenPayload }. The caller is responsible for computing
 * seenConfidence via WorkflowConfidenceService.computeForGate (async / DB).
 */
export function buildGateSnapshot(
  stepDefinition: {
    id: string;
    type: string;
    name?: string;
    params?: Record<string, unknown>;
    isCritical?: boolean;
    sideEffectClass?: string;
  },
  options?: {
    agentReasoning?: string | null;
    branchDecision?: { field: string; resolvedValue: unknown; targetStep: string } | null;
  },
): { seenPayload: SeenPayload } {
  const seenPayload = buildSeenPayload({
    stepDefinition,
    agentReasoning: options?.agentReasoning,
    branchDecision: options?.branchDecision,
  });

  return { seenPayload };
}
