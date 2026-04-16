/**
 * memoryEntryQualityServicePure — pure logic for memory entry quality management
 *
 * This module holds the deterministic math for decay and pruning so it can be
 * unit tested without a database. The impure layer in
 * `memoryEntryQualityService.ts` calls these functions and applies the results.
 *
 * Contract:
 *   - `computeDecayFactor(params)` — returns the multiplicative factor (0–1)
 *     by which an entry's qualityScore should be reduced. Factor = 1 means no
 *     decay (within window or never accessed). Factor = 0 means fully decayed.
 *
 *   - `isPruneEligible(params)` — returns true when the entry meets ALL three
 *     pruning criteria: age, low quality, and below threshold.
 *
 * Spec: docs/memory-and-briefings-spec.md §4.1 (S1)
 */

import {
  DECAY_RATE,
  DECAY_WINDOW_DAYS,
  PRUNE_THRESHOLD,
  PRUNE_AGE_DAYS,
  QUALITY_ADJUST_MIN_INJECTIONS,
  QUALITY_ADJUST_HIGH_UTILITY,
  QUALITY_ADJUST_LOW_UTILITY,
  QUALITY_ADJUST_BOOST_DELTA,
  QUALITY_ADJUST_REDUCTION_DELTA,
} from '../config/limits.js';

// ---------------------------------------------------------------------------
// computeDecayFactor
// ---------------------------------------------------------------------------

export interface DecayParams {
  /** Current qualityScore (0.0–1.0) */
  qualityScore: number;
  /** When the entry was last accessed. Null = never accessed. */
  lastAccessedAt: Date | null;
  /** Reference time. Callers supply this so tests can pin the clock. */
  now: Date;
}

/**
 * Returns the multiplicative decay factor to apply to qualityScore.
 *
 * Rules (§4.1):
 * - If the entry has been accessed within DECAY_WINDOW_DAYS, factor = 1.0
 *   (no decay — the entry is still in active use).
 * - If never accessed, compute days since epoch as a proxy (will decay quickly).
 * - Otherwise: factor = max(0, 1 - DECAY_RATE * daysOverWindow)
 *   where daysOverWindow = daysSinceLastAccess - DECAY_WINDOW_DAYS.
 *
 * The factor is clamped to [0, 1] so qualityScore never goes negative.
 */
export function computeDecayFactor(params: DecayParams): number {
  const { lastAccessedAt, now } = params;

  // Never accessed — treat as accessed at entry creation time = high decay risk.
  // Since we don't have createdAt here, use now - DECAY_WINDOW_DAYS as worst case.
  if (lastAccessedAt === null) {
    // Entry has never been accessed; treat as if last accessed exactly
    // DECAY_WINDOW_DAYS ago (worst safe starting point).
    const daysOverWindow = DECAY_WINDOW_DAYS;
    const factor = 1 - DECAY_RATE * daysOverWindow;
    return Math.max(0.1, factor);
  }

  const msSinceAccess = now.getTime() - lastAccessedAt.getTime();
  const daysSinceAccess = msSinceAccess / (1000 * 60 * 60 * 24);

  if (daysSinceAccess <= DECAY_WINDOW_DAYS) {
    // Within active window — no decay.
    return 1.0;
  }

  const daysOverWindow = daysSinceAccess - DECAY_WINDOW_DAYS;
  const factor = 1 - DECAY_RATE * daysOverWindow;
  return Math.max(0.1, factor);
}

// ---------------------------------------------------------------------------
// isPruneEligible
// ---------------------------------------------------------------------------

export interface PruneParams {
  /** Current (post-decay) qualityScore (0.0–1.0) */
  qualityScore: number;
  /** Entry creation date (fallback pivot when lastAccessedAt is null) */
  createdAt: Date;
  /** When the entry was last accessed. Null = never — use createdAt as fallback. */
  lastAccessedAt: Date | null;
  /** Reference time */
  now: Date;
}

/**
 * Returns true when ALL pruning conditions are met (§4.1):
 *   1. qualityScore < PRUNE_THRESHOLD
 *   2. Entry's lastAccessedAt (or createdAt if never accessed) is older than
 *      PRUNE_AGE_DAYS
 *
 * Both conditions must be true — low quality alone doesn't prune a fresh
 * entry, and old age alone doesn't prune a high-quality one.
 */
export function isPruneEligible(params: PruneParams): boolean {
  const { qualityScore, createdAt, lastAccessedAt, now } = params;

  if (qualityScore >= PRUNE_THRESHOLD) {
    return false;
  }

  const agePivot = lastAccessedAt ?? createdAt;
  const msAge = now.getTime() - agePivot.getTime();
  const daysAge = msAge / (1000 * 60 * 60 * 24);

  return daysAge >= PRUNE_AGE_DAYS;
}

// ---------------------------------------------------------------------------
// S4: utility-based quality adjustment (§4.4)
// ---------------------------------------------------------------------------

export interface UtilityAdjustmentParams {
  /** Current qualityScore in [0, 1]. */
  qualityScore: number;
  /** Rolling-window injectedCount. Below MIN_INJECTIONS → no adjustment. */
  injectedCount: number;
  /** Rolling-window citedCount. */
  citedCount: number;
}

export interface UtilityAdjustmentDecision {
  /** Action taken on the entry's qualityScore. */
  action: 'boost' | 'reduce' | 'noop_insufficient_data' | 'noop_neutral_utility' | 'noop_ceiling_or_floor';
  /** The post-adjustment qualityScore. Equal to the input when no action. */
  newScore: number;
  /** utilityRate = citedCount / injectedCount, or 0 when injectedCount==0. */
  utilityRate: number;
}

/**
 * Decide whether to boost, reduce, or leave an entry's qualityScore.
 *
 * Rules (§4.4):
 *   - injectedCount < QUALITY_ADJUST_MIN_INJECTIONS → no action (insufficient data)
 *   - utilityRate > QUALITY_ADJUST_HIGH_UTILITY → boost (+BOOST_DELTA, capped at 1.0)
 *   - utilityRate < QUALITY_ADJUST_LOW_UTILITY → reduce (-REDUCTION_DELTA, floored at 0.0)
 *   - utilityRate in [LOW, HIGH] → no action (neutral band)
 *   - injectedCount == 0 → no action (never injected; §4.4 last bullet)
 *
 * Score bounds: capped at 1.0, floored at 0.0. At the ceiling, further boosts
 * are no-ops; at the floor, further reductions are no-ops.
 *
 * Pure: this function makes the decision but persists nothing.
 */
export function decideUtilityAdjustment(params: UtilityAdjustmentParams): UtilityAdjustmentDecision {
  const { qualityScore, injectedCount, citedCount } = params;

  // Never injected → never adjusted (§4.4 last bullet)
  if (injectedCount === 0) {
    return {
      action: 'noop_insufficient_data',
      newScore: qualityScore,
      utilityRate: 0,
    };
  }

  const utilityRate = citedCount / injectedCount;

  // Insufficient data → no adjustment
  if (injectedCount < QUALITY_ADJUST_MIN_INJECTIONS && utilityRate < QUALITY_ADJUST_HIGH_UTILITY) {
    // Still too early to penalise; only high-utility entries may be boosted early.
    return {
      action: 'noop_insufficient_data',
      newScore: qualityScore,
      utilityRate,
    };
  }

  if (utilityRate > QUALITY_ADJUST_HIGH_UTILITY) {
    if (qualityScore >= 1.0) {
      return { action: 'noop_ceiling_or_floor', newScore: 1.0, utilityRate };
    }
    const newScore = Math.min(1.0, qualityScore + QUALITY_ADJUST_BOOST_DELTA);
    return { action: 'boost', newScore, utilityRate };
  }

  if (utilityRate < QUALITY_ADJUST_LOW_UTILITY) {
    if (qualityScore <= 0.0) {
      return { action: 'noop_ceiling_or_floor', newScore: 0.0, utilityRate };
    }
    const newScore = Math.max(0.0, qualityScore - QUALITY_ADJUST_REDUCTION_DELTA);
    return { action: 'reduce', newScore, utilityRate };
  }

  return {
    action: 'noop_neutral_utility',
    newScore: qualityScore,
    utilityRate,
  };
}
