/**
 * workflowConfidenceServicePure — pure heuristic for computing gate confidence.
 *
 * No DB calls. Safe to use in tests and any context.
 */

import { CONFIDENCE_COPY, type ConfidenceKey } from './workflowConfidenceCopyMap.js';
import type { SeenConfidence } from '../../shared/types/workflowStepGate.js';

export interface ConfidenceInputs {
  templateVersionId: string;
  stepId: string;
  isCritical: boolean;
  sideEffectClass: 'irreversible' | 'reversible' | 'none' | null;
  pastReviewsCount: { approved: number; rejected: number };
  subaccountFirstUseFlag: boolean;
  upstreamConfidence: 'high' | 'medium' | 'low' | null;
}

/**
 * Compute a SeenConfidence from heuristic inputs.
 *
 * Priority order (highest wins):
 * 1. upstreamConfidence === 'low'         → upstream_low_confidence
 * 2. subaccountFirstUseFlag               → first_use_in_subaccount
 * 3. isCritical                           → next_step_critical
 * 4. sideEffectClass === 'irreversible'   → irreversible_side_effect
 * 5. many past runs AND ≥80% approval     → many_past_runs_no_clamps
 * 6. default                              → few_past_runs_mixed
 */
export function computeConfidence(inputs: ConfidenceInputs): SeenConfidence {
  let key: ConfidenceKey;

  if (inputs.upstreamConfidence === 'low') {
    key = 'upstream_low_confidence';
  } else if (inputs.subaccountFirstUseFlag) {
    key = 'first_use_in_subaccount';
  } else if (inputs.isCritical) {
    key = 'next_step_critical';
  } else if (inputs.sideEffectClass === 'irreversible') {
    key = 'irreversible_side_effect';
  } else {
    const total = inputs.pastReviewsCount.approved + inputs.pastReviewsCount.rejected;
    const approvalRatio = total > 0 ? inputs.pastReviewsCount.approved / total : 0;
    if (total >= 5 && approvalRatio >= 0.8) {
      key = 'many_past_runs_no_clamps';
    } else {
      key = 'few_past_runs_mixed';
    }
  }

  const copy = CONFIDENCE_COPY[key];
  return {
    value: copy.chip.toLowerCase() as 'high' | 'medium' | 'low',
    reason: copy.reason,
    computed_at: new Date().toISOString(),
    signals: [{ name: key, weight: 1 }],
  };
}
