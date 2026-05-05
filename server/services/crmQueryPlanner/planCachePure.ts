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

// INVARIANT — plan-shape versioning contract (spec §7.5).
//
// `NORMALISER_VERSION` is the single knob that invalidates cached plans. The
// spec scopes it to "behaviour that affects output hash" (tokenisation,
// synonyms, stop-words, hash derivation). In practice, because re-validation
// on cache hit only re-runs principal-dependent rules (§9.3.1, not the full
// validator with schemaContext), ANY change that can alter the SHAPE of the
// plan produced for a given normalised intent must also bump
// `NORMALISER_VERSION` so cached entries become unreachable under the new key.
//
// This includes — but is not limited to —
//   • normaliser output hash (per §7.5 enumerated list)
//   • registry matcher semantics (stage 1 → different plan for same intent)
//   • validator rule set changes that reshape plans (field projection, filter
//     normalisation, source promotion — rules 8, 9, 10)
//   • filter-translation semantics in executors that are baked into the cached
//     plan shape
//
// Additive changes that only add new optional trace/analytics fields do NOT
// require a bump. When in doubt, bump. Old entries expire within one TTL cycle
// (§9.2) so bumping is always safe.
export function makeCacheKey(hash: string, subaccountId: string): string {
  return `v${NORMALISER_VERSION}:${subaccountId}:${hash}`;
}

// ── Expiry check ──────────────────────────────────────────────────────────────

export function isExpired(entry: PlanCacheEntry, nowMs: number): boolean {
  return nowMs - entry.cachedAt > CACHE_TTL_MS[entry.cacheConfidence];
}
