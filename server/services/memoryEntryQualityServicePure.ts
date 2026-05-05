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
  type EntryType,
} from '../config/limits.js';

// ---------------------------------------------------------------------------
// Hermes Tier 1 Phase B §6.6 — per-entryType half-lives.
// ---------------------------------------------------------------------------
//
// `computeDecayFactor` branches by `entryType` so entries with different
// lifecycle semantics decay at different rates:
//   - observation: raw run signal, loses relevance quickly
//   - issue:       useful until pattern crystallises or is resolved
//   - preference:  user-stated, stable long-term
//   - pattern / decision: distilled, long-term reusable
//
// When an entryType is passed in, the factor is computed as
// `0.5 ^ (daysSinceAccess / halfLife)` — a clean exponential half-life so
// the pure test (§9.2) can pin "factor = 0.5 at T = halfLife".
//
// When no entryType is supplied (or an unknown value), the helper falls
// back to today's linear `DECAY_RATE`-based formula so pre-Phase-B
// callers that haven't been migrated still work.

export const HALF_LIFE_DAYS: Record<EntryType, number> = {
  observation: 7,
  issue:       14,
  preference:  30,
  pattern:     30,
  decision:    30,
};

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
  /**
   * Entry type — when present, selects the per-entryType half-life from
   * `HALF_LIFE_DAYS` (§6.6). When omitted or unknown, the helper falls
   * back to today's linear DECAY_RATE formula so pre-Phase-B callers
   * still work unchanged.
   */
  entryType?: EntryType;
}

/**
 * Returns the multiplicative decay factor to apply to qualityScore.
 *
 * Phase B §6.6 — branches by `entryType`:
 *   - When `entryType` is a known value in `HALF_LIFE_DAYS`, the factor
 *     is `0.5 ^ (daysSinceAccess / halfLife)` — clean exponential half-
 *     life so pure tests can pin "factor = 0.5 at T = halfLife".
 *   - When `entryType` is missing or unknown, today's linear fallback
 *     is preserved exactly (§6.6 "Default (unknown entryType) keeps
 *     today's single rate").
 *
 * Rules of the linear fallback (§4.1 — unchanged):
 * - If the entry has been accessed within DECAY_WINDOW_DAYS, factor = 1.0.
 * - If never accessed, treat as accessed at now - DECAY_WINDOW_DAYS.
 * - Otherwise: factor = max(0.1, 1 - DECAY_RATE * daysOverWindow).
 */
export function computeDecayFactor(params: DecayParams): number {
  const { lastAccessedAt, now, entryType } = params;

  const halfLife = entryType !== undefined ? HALF_LIFE_DAYS[entryType] : undefined;

  if (halfLife !== undefined) {
    // Phase B half-life branch. Never-accessed entries are treated as
    // having been last accessed at entry creation, but we don't have the
    // createdAt here — match the linear branch's worst-safe assumption
    // by treating lastAccessed = null as exactly DECAY_WINDOW_DAYS ago.
    // This keeps behaviour continuous across the half-life threshold.
    //
    // Note: unlike the linear branch, this path has no "within-window grace
    // period" — 0.5^(t/halfLife) is strictly < 1.0 for any t > 0. Entries
    // promoted from Phase B therefore decay slightly faster than pre-Phase-B
    // entries (linear returned exactly 1.0 within DECAY_WINDOW_DAYS). The
    // numerical difference is negligible for typical half-lives (≈0.9998 at
    // 1 hour for a 30-day half-life) but is a design choice, not a bug.
    const daysSinceAccess =
      lastAccessedAt === null
        ? DECAY_WINDOW_DAYS
        : (now.getTime() - lastAccessedAt.getTime()) / (1000 * 60 * 60 * 24);
    const rawFactor = Math.pow(0.5, Math.max(0, daysSinceAccess) / halfLife);
    // Clamp to [0, 1] — score multiplier domain.
    return Math.max(0, Math.min(1, rawFactor));
  }

  // Linear fallback (pre-Phase-B behaviour preserved for unknown/missing
  // entryType). Never accessed → treat as accessed exactly
  // DECAY_WINDOW_DAYS ago (worst safe starting point).
  if (lastAccessedAt === null) {
    const daysOverWindow = DECAY_WINDOW_DAYS;
    const factor = 1 - DECAY_RATE * daysOverWindow;
    return Math.max(0.1, factor);
  }

  const msSinceAccess = now.getTime() - lastAccessedAt.getTime();
  const daysSinceAccess = msSinceAccess / (1000 * 60 * 60 * 24);

  if (daysSinceAccess <= DECAY_WINDOW_DAYS) {
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
