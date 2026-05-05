// Phase 7 / W3b — Pure teachability heuristic for approval-gate suggestion panel.
// Spec: docs/universal-brief-dev-spec.md §6.3.4

import type { BriefApprovalCard } from '../../shared/types/briefResultContract.js';

export interface TeachabilityConfig {
  minNoveltyScore: number;
  skipBackoffThreshold: number;
  skipBackoffWindowDays: number;
}

export const DEFAULT_TEACHABILITY_CONFIG: TeachabilityConfig = {
  minNoveltyScore: 0.7,
  skipBackoffThreshold: 5,
  skipBackoffWindowDays: 7,
};

export interface TeachabilityInput {
  approvalCard: BriefApprovalCard;
  wasApproved: boolean;
  userContext: {
    priorSimilarApprovals: number;
    daysSinceLastCapture: number | null;
    skipStreakCount: number;
    suggestionFrequency: 'off' | 'occasional' | 'frequent';
    suggestionBackoffUntil: Date | null;
  };
  config: TeachabilityConfig;
}

export interface TeachabilityOutput {
  shouldSuggest: boolean;
  reason: 'novel' | 'routine' | 'on_backoff' | 'user_disabled';
  noveltyScore: number;
}

function computeNoveltyScore(input: TeachabilityInput): number {
  const { approvalCard, wasApproved, userContext } = input;
  let score = 0.5;

  // Novel if it's the first time we've seen a similar approval
  if (userContext.priorSimilarApprovals === 0) score += 0.3;
  else if (userContext.priorSimilarApprovals <= 2) score += 0.1;
  else score -= 0.2;

  // High-risk actions are more likely to benefit from a rule
  if (approvalCard.riskLevel === 'high') score += 0.2;
  else if (approvalCard.riskLevel === 'medium') score += 0.1;

  // Rejections are stronger signals than approvals
  if (!wasApproved) score += 0.15;

  // Frequent capturer — they know what they want
  if (userContext.daysSinceLastCapture !== null && userContext.daysSinceLastCapture < 7) {
    score += 0.05;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Pure tier-1 heuristic for whether to show the "teach the system?" panel.
 * Returns false (no suggestion) for 'off' preference, active backoff, or low novelty.
 */
export function classifyTeachabilityPure(input: TeachabilityInput): TeachabilityOutput {
  const { userContext, config } = input;

  if (userContext.suggestionFrequency === 'off') {
    return { shouldSuggest: false, reason: 'user_disabled', noveltyScore: 0 };
  }

  if (
    userContext.suggestionBackoffUntil &&
    userContext.suggestionBackoffUntil > new Date()
  ) {
    return { shouldSuggest: false, reason: 'on_backoff', noveltyScore: 0 };
  }

  if (userContext.skipStreakCount >= config.skipBackoffThreshold) {
    return { shouldSuggest: false, reason: 'on_backoff', noveltyScore: 0 };
  }

  const noveltyScore = computeNoveltyScore(input);
  const minScore =
    userContext.suggestionFrequency === 'frequent'
      ? config.minNoveltyScore * 0.7
      : config.minNoveltyScore;

  if (noveltyScore < minScore) {
    return { shouldSuggest: false, reason: 'routine', noveltyScore };
  }

  return { shouldSuggest: true, reason: 'novel', noveltyScore };
}
