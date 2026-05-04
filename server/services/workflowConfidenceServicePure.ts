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

// Architect-tuned 2026-05-04 — see tasks/builds/workflows-v1-phase-2/confidence-cut-points-decision.md
// Clean history: 3+ approvals with zero rejections. Even a small sample is strong signal
// when there are literally zero rejections. Covers the common V1 pattern where a template
// is reviewed carefully for its first 3 runs then becomes routine.
const CLEAN_HISTORY_MIN_APPROVED = 3;
// Established pattern: 5+ reviews with <15% rejection rate. 15% chosen over 20% (old default)
// because at 5 reviews, 1 rejection = 20% — a 1-in-5 rejection rate still warrants
// medium confidence. At 15%, you need 0 rejections in 5 reviews, OR 1 rejection in 7+.
const ESTABLISHED_PATTERN_MIN_TOTAL = 5;
const ESTABLISHED_PATTERN_MAX_REJECTION_RATE = 0.15;

/**
 * Compute the confidence heuristic for a gate.
 *
 * Priority order (§6.1 — first matching rule wins):
 * 1. upstreamConfidence === 'low'  → cascade_from_low_confidence
 * 2. subaccountFirstUseFlag        → first_use_in_subaccount
 * 3. stepDefinition.isCritical     → is_critical_next_step
 * 4. sideEffectClass === 'irreversible' → irreversible_side_effect
 * 5. clean history OR established pattern → many_similar_past_runs
 * 6. default                       → few_past_runs_mixed_history
 */
export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const { stepDefinition, pastReviewsCount, subaccountFirstUseFlag, upstreamConfidence } = input;
  const total = pastReviewsCount.approved + pastReviewsCount.rejected;

  // Signal weight for past_run_history: fires when either high-confidence pathway is met.
  const pastRunHistorySignal =
    (pastReviewsCount.approved >= CLEAN_HISTORY_MIN_APPROVED &&
      pastReviewsCount.rejected === 0) ||
    (total >= ESTABLISHED_PATTERN_MIN_TOTAL &&
      total > 0 &&
      pastReviewsCount.rejected / total < ESTABLISHED_PATTERN_MAX_REJECTION_RATE)
      ? 1
      : 0;

  // Build signal array — always populated regardless of which rule fires.
  const signals = [
    { name: 'upstream_low_confidence', weight: upstreamConfidence === 'low' ? 1 : 0 },
    { name: 'subaccount_first_use', weight: subaccountFirstUseFlag ? 1 : 0 },
    { name: 'is_critical', weight: stepDefinition.isCritical ? 1 : 0 },
    {
      name: 'irreversible_side_effect',
      weight: stepDefinition.sideEffectClass === 'irreversible' ? 1 : 0,
    },
    { name: 'past_run_history', weight: pastRunHistorySignal },
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
  } else if (
    (pastReviewsCount.approved >= CLEAN_HISTORY_MIN_APPROVED &&
      pastReviewsCount.rejected === 0) ||
    (total >= ESTABLISHED_PATTERN_MIN_TOTAL &&
      total > 0 &&
      pastReviewsCount.rejected / total < ESTABLISHED_PATTERN_MAX_REJECTION_RATE)
  ) {
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
