// Plan cache — pure helpers (spec §9)
// Key generation, TTL computation, expiry check. No state.

import { NORMALISER_VERSION } from '../../../shared/types/crmQueryPlanner.js';
import type { PlanCacheEntry } from '../../../shared/types/crmQueryPlanner.js';

// ── TTL tiers (§9.2) ──────────────────────────────────────────────────────────

export const CACHE_TTL_MS: Record<PlanCacheEntry['cacheConfidence'], number> = {
  high:   60_000,
  medium: 60_000,
  low:    15_000,
};

export const MAX_CACHE_ENTRIES = 500;

// ── Cache key (§9.1) ──────────────────────────────────────────────────────────

export function makeCacheKey(hash: string, subaccountId: string): string {
  return `v${NORMALISER_VERSION}:${subaccountId}:${hash}`;
}

// ── Expiry check ──────────────────────────────────────────────────────────────

export function isExpired(entry: PlanCacheEntry, nowMs: number): boolean {
  return nowMs - entry.cachedAt > CACHE_TTL_MS[entry.cacheConfidence];
}
