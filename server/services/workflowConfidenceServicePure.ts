/**
 * workflowConfidenceServicePure — pure heuristic for seen_confidence.
 *
 * Spec: docs/workflows-dev-spec.md §6.1, §6.2, §6.4.
 *
 * No DB. No I/O. Priority-ordered rules: first match wins.
 *
 * IMPORTANT (§6.4): high confidence MUST NOT auto-approve. The returned value
 * is a display hint only. The gate remains open regardless of the result.
 */

import type { SeenConfidence } from '../../shared/types/workflowStepGate.js';
import type { ConfidenceKey } from './workflowConfidenceCopyMap.js';
import { CONFIDENCE_COPY_MAP } from './workflowConfidenceCopyMap.js';

export interface ConfidenceInput {
  stepDefinition: {
    isCritical?: boolean;
    sideEffectClass?: 'none' | 'idempotent' | 'reversible' | 'irreversible';
  };
  pastReviewsCount: { approved: number; rejected: number };
  subaccountFirstUseFlag: boolean;
  upstreamConfidence: 'high' | 'medium' | 'low' | null;
}

export interface ConfidenceResult {
  key: ConfidenceKey;
  confidence: SeenConfidence;
}

/**
 * Compute the confidence heuristic for a gate.
 *
 * Priority order (§6.1 — first matching rule wins):
 * 1. upstreamConfidence === 'low'  → cascade_from_low_confidence
 * 2. subaccountFirstUseFlag        → first_use_in_subaccount
 * 3. stepDefinition.isCritical     → is_critical_next_step
 * 4. sideEffectClass === 'irreversible' → irreversible_side_effect
 * 5. approved+rejected >= 5 AND rejected/total < 0.2 → many_similar_past_runs
 * 6. default                       → few_past_runs_mixed_history
 */
export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const { stepDefinition, pastReviewsCount, subaccountFirstUseFlag, upstreamConfidence } = input;
  const total = pastReviewsCount.approved + pastReviewsCount.rejected;

  // Build signal array — always populated regardless of which rule fires.
  const signals = [
    { name: 'upstream_low_confidence', weight: upstreamConfidence === 'low' ? 1 : 0 },
    { name: 'subaccount_first_use', weight: subaccountFirstUseFlag ? 1 : 0 },
    { name: 'is_critical', weight: stepDefinition.isCritical ? 1 : 0 },
    {
      name: 'irreversible_side_effect',
      weight: stepDefinition.sideEffectClass === 'irreversible' ? 1 : 0,
    },
    { name: 'past_run_history', weight: total >= 5 ? 1 : 0 },
  ];

  // Determine the winning key by priority order.
  let key: ConfidenceKey;

  if (upstreamConfidence === 'low') {
    key = 'cascade_from_low_confidence';
  } else if (subaccountFirstUseFlag) {
    key = 'first_use_in_subaccount';
  } else if (stepDefinition.isCritical) {
    key = 'is_critical_next_step';
  } else if (stepDefinition.sideEffectClass === 'irreversible') {
    key = 'irreversible_side_effect';
  } else if (total >= 5 && pastReviewsCount.rejected / total < 0.2) {
    key = 'many_similar_past_runs';
  } else {
    key = 'few_past_runs_mixed_history';
  }

  const { value, reason } = CONFIDENCE_COPY_MAP[key];

  return {
    key,
    confidence: {
      value,
      reason,
      computed_at: new Date().toISOString(),
      signals,
    },
  };
}
