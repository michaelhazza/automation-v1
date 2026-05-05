// Plan cache — in-process Map with LRU eviction (spec §9)
// Write-dark in P1; write path used in P2+ when Stage 3 succeeds.

import { makeCacheKey, isExpired, MAX_CACHE_ENTRIES } from './planCachePure.js';
import { validatePlanPure, ValidationError } from './validatePlanPure.js';
import type {
  QueryPlan,
  PlanCacheEntry,
  CanonicalQueryRegistry,
} from '../../../shared/types/crmQueryPlanner.js';

// ── Storage ───────────────────────────────────────────────────────────────────

// Map insertion order = access order for basic LRU (most recently inserted = last).
// On overflow, delete the FIRST entry (least recently inserted / accessed).
const cache = new Map<string, PlanCacheEntry>();

// ── LRU eviction ─────────────────────────────────────────────────────────────

function evictOldest(): void {
  const first = cache.keys().next().value;
  if (first !== undefined) cache.delete(first);
}

function touch(key: string, entry: PlanCacheEntry): void {
  // Re-insert at end to simulate access-order LRU
  cache.delete(key);
  cache.set(key, entry);
}

// ── Public interface ──────────────────────────────────────────────────────────

export type PlanCacheMissReason = 'not_present' | 'expired' | 'principal_mismatch';

export type PlanCacheGetResult =
  | { hit: true; plan: QueryPlan; entry: PlanCacheEntry }
  | { hit: false; reason: PlanCacheMissReason };

/**
 * Retrieve a cached plan. Returns a discriminated result so `stage2_cache_miss`
 * can distinguish not-present / expired / principal-mismatch per §9.3.1.
 */
export function get(
  hash: string,
  subaccountId: string,
  context: {
    callerCapabilities: Set<string>;
    registry: CanonicalQueryRegistry;
  },
): PlanCacheGetResult {
  const key = makeCacheKey(hash, subaccountId);
  const entry = cache.get(key);
  if (!entry) return { hit: false, reason: 'not_present' };

  if (isExpired(entry, Date.now())) {
    cache.delete(key);
    return { hit: false, reason: 'expired' };
  }

  // Rerun principal-dependent rules (§9.3.1)
  try {
    validatePlanPure(entry.plan as any, {
      mode: 'full',
      stageResolved: entry.plan.stageResolved,
      costPreview: entry.plan.costPreview,
      schemaContext: null, // skip schema rules — only principal rules matter here
      registry: context.registry,
      callerCapabilities: context.callerCapabilities,
    });
  } catch (e) {
    if (e instanceof ValidationError) {
      return { hit: false, reason: 'principal_mismatch' };
    }
    throw e;
  }

  // Increment hits + touch for LRU
  const updated = { ...entry, hits: entry.hits + 1 };
  touch(key, updated);
  return { hit: true, plan: entry.plan, entry: updated };
}

/**
 * Store a validated plan. Only stageResolved === 3 plans are cached (§9.3).
 * Write-dark in P1 — this is wired so P2's first Stage 3 success just works.
 */
export function set(
  hash: string,
  subaccountId: string,
  plan: QueryPlan,
  cacheConfidence: PlanCacheEntry['cacheConfidence'],
): void {
  if (plan.stageResolved !== 3) return; // only cache Stage 3 results

  const key = makeCacheKey(hash, subaccountId);
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
    evictOldest();
  }
  cache.set(key, {
    plan,
    cachedAt:          Date.now(),
    subaccountId,
    hits:              0,
    cacheConfidence,
    normaliserVersion: 1,
  });
}

/** Visible for testing only. */
export function _clear(): void {
  cache.clear();
}

export function _size(): number {
  return cache.size;
}
