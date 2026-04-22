// Hybrid executor — pure helpers (spec §14)
// Separated from hybridExecutor.ts so tests can import splitHybridPlan
// without pulling in the executor's DB/GHL dependency chain.

import { isLiveOnlyField } from './liveExecutorPure.js';
import type { QueryPlan, QueryFilter } from '../../../../shared/types/crmQueryPlanner.js';

export const HYBRID_LIVE_CALL_CAP = 10;

// ── Errors ────────────────────────────────────────────────────────────────────

export class HybridCapError extends Error {
  readonly errorCode = 'cost_exceeded';
  constructor(message: string) {
    super(message);
    this.name = 'HybridCapError';
  }
}

export class HybridLiveCallError extends Error {
  readonly errorCode = 'live_call_failed';
  constructor(message: string) {
    super(message);
    this.name = 'HybridLiveCallError';
  }
}

// ── Plan splitting ─────────────────────────────────────────────────────────────

export interface SplitHybridPlan {
  canonicalBase: QueryPlan;
  liveFilters:   QueryFilter[];
}

export function splitHybridPlan(plan: QueryPlan): SplitHybridPlan {
  const canonicalFilters: QueryFilter[] = [];
  const liveFilters: QueryFilter[] = [];

  for (const filter of plan.filters) {
    if (isLiveOnlyField(filter.field)) {
      liveFilters.push(filter);
    } else {
      canonicalFilters.push(filter);
    }
  }

  const canonicalBase: QueryPlan = {
    ...plan,
    source:    'canonical',
    filters:   canonicalFilters,
    validated: true,
  };

  return { canonicalBase, liveFilters };
}

// ── Live-filter row matching ─────────────────────────────────────────────────

export function matchesLiveFilter(
  liveRow: Record<string, unknown>,
  filter: QueryFilter,
): boolean {
  const val = liveRow[filter.field];
  if (val === undefined) return false;
  switch (filter.operator) {
    case 'eq':       return String(val) === String(filter.value);
    case 'ne':       return String(val) !== String(filter.value);
    case 'contains': return String(val).includes(String(filter.value));
    default:         return true;
  }
}
