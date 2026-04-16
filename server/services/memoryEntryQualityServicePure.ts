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
    // Entry has never been accessed; apply one full window's worth of decay.
    const daysOverWindow = DECAY_WINDOW_DAYS; // worst-case: treat as stale immediately
    const factor = 1 - DECAY_RATE * daysOverWindow;
    return Math.max(0, factor);
  }

  const msSinceAccess = now.getTime() - lastAccessedAt.getTime();
  const daysSinceAccess = msSinceAccess / (1000 * 60 * 60 * 24);

  if (daysSinceAccess <= DECAY_WINDOW_DAYS) {
    // Within active window — no decay.
    return 1.0;
  }

  const daysOverWindow = daysSinceAccess - DECAY_WINDOW_DAYS;
  const factor = 1 - DECAY_RATE * daysOverWindow;
  return Math.max(0, factor);
}

// ---------------------------------------------------------------------------
// isPruneEligible
// ---------------------------------------------------------------------------

export interface PruneParams {
  /** Current (post-decay) qualityScore (0.0–1.0) */
  qualityScore: number;
  /** Entry creation date */
  createdAt: Date;
  /** Reference time */
  now: Date;
}

/**
 * Returns true when ALL three pruning conditions are met (§4.1):
 *   1. qualityScore < PRUNE_THRESHOLD
 *   2. Entry is older than PRUNE_AGE_DAYS
 *
 * Both conditions must be true — low quality alone doesn't prune a fresh
 * entry, and old age alone doesn't prune a high-quality one.
 */
export function isPruneEligible(params: PruneParams): boolean {
  const { qualityScore, createdAt, now } = params;

  if (qualityScore >= PRUNE_THRESHOLD) {
    return false;
  }

  const msAge = now.getTime() - createdAt.getTime();
  const daysAge = msAge / (1000 * 60 * 60 * 24);

  return daysAge >= PRUNE_AGE_DAYS;
}
