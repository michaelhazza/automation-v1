// Hybrid executor — canonical_base_with_live_filter (spec §14)
// Only v1 hybrid pattern: runs canonical base, then applies one live filter
// to the result set with a hard cap of 10 live calls.

import { executeCanonical } from './canonicalExecutor.js';
import { executeLive } from './liveExecutor.js';
import { logger } from '../../../lib/logger.js';
import {
  HYBRID_LIVE_CALL_CAP,
  HybridCapError,
  HybridLiveCallError,
  splitHybridPlan,
  matchesLiveFilter,
} from './hybridExecutorPure.js';
import type {
  QueryPlan,
  QueryFilter,
  ExecutorResult,
  ExecutorContext,
  CanonicalQueryRegistry,
} from '../../../../shared/types/crmQueryPlanner.js';

export { HybridCapError, HybridLiveCallError, splitHybridPlan } from './hybridExecutorPure.js';

// ── Live filter application ────────────────────────────────────────────────────

/**
 * Applies live filters to rows from the canonical base. Batches are single calls
 * per field (v1 simple implementation — one GHL call per live filter field).
 * Each call fetches all live-only field values for the entire row set.
 */
async function applyLiveFilter(
  baseRows: Array<Record<string, unknown>>,
  liveFilters: QueryFilter[],
  plan: QueryPlan,
  context: ExecutorContext,
): Promise<Array<Record<string, unknown>>> {
  if (liveFilters.length === 0) return baseRows;

  // Pre-dispatch cap estimate: one call per live filter per batch
  // (v1: we batch per-field, so callCount = liveFilters.length)
  if (liveFilters.length > HYBRID_LIVE_CALL_CAP) {
    throw new HybridCapError(
      `Hybrid query would require ${liveFilters.length} live calls (cap: ${HYBRID_LIVE_CALL_CAP}). ` +
      'Narrow the canonical base first.',
    );
  }

  let callCount = 0;

  // Build a live plan targeting the same entity with the live-only filters
  const livePlan: QueryPlan = {
    ...plan,
    source:    'live',
    filters:   liveFilters,
    validated: true,
  };

  // Fetch the live data once for all rows in the base result
  if (callCount >= HYBRID_LIVE_CALL_CAP) {
    throw new HybridCapError('Hybrid live-call cap reached mid-iteration.');
  }

  let liveResult: ExecutorResult;
  try {
    liveResult = await executeLive(livePlan, context);
    callCount++;
  } catch (err) {
    throw new HybridLiveCallError(`Live filter call failed: ${(err as Error).message}`);
  }

  if (callCount > HYBRID_LIVE_CALL_CAP) {
    throw new HybridCapError('Hybrid live-call cap reached mid-iteration.');
  }

  // Build a lookup map from live results keyed on id
  const liveById = new Map<string, Record<string, unknown>>();
  for (const row of liveResult.rows) {
    if (row.id) liveById.set(String(row.id), row);
  }

  // Filter base rows: keep only those that also appear in the live result
  // (live-only filter is a reducing filter — no new rows added)
  return baseRows.filter(row => {
    if (!row.id) return false;
    const liveRow = liveById.get(String(row.id));
    if (!liveRow) return false;
    return liveFilters.every(filter => matchesLiveFilter(liveRow, filter));
  });
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function executeHybrid(
  plan: QueryPlan,
  context: ExecutorContext,
  registry: CanonicalQueryRegistry,
): Promise<ExecutorResult> {
  if (plan.source !== 'hybrid') {
    throw new Error('hybridExecutor dispatched with non-hybrid plan');
  }
  if (plan.hybridPattern !== 'canonical_base_with_live_filter') {
    throw new Error(`unsupported hybrid pattern: ${plan.hybridPattern}`);
  }

  // Split plan
  const { canonicalBase, liveFilters } = splitHybridPlan(plan);

  // Step 1: run canonical base
  const baseResult = await executeCanonical(canonicalBase, context, registry);

  // Near-cap signal: if the canonical base already returned plan.limit rows
  // AND we still have live-only filters to apply in-memory, the working set
  // is at the v1 structural ceiling (spec §13.4 / §14.3: default limit 100).
  // This doesn't fail the query — the live filter will reduce the set — but
  // it's the strongest signal we have that a caller will need an ID-scoped
  // live fetch (deferred — see tasks/todo.md) once the cap is raised, or that
  // the canonical base needs narrowing. Emit a warn so it's visible in logs
  // without needing a new plannerEvent kind.
  if (liveFilters.length > 0 && baseResult.rowCount >= plan.limit) {
    logger.warn('crm_query_planner.hybrid_base_at_plan_limit', {
      baseRowCount:    baseResult.rowCount,
      planLimit:       plan.limit,
      liveFilterCount: liveFilters.length,
      primaryEntity:   plan.primaryEntity,
      orgId:           context.orgId,
      subaccountId:    context.subaccountId,
    });
  }

  // Step 2: pre-dispatch cap check against actual base row count
  const estimatedCalls = liveFilters.length;
  if (estimatedCalls > HYBRID_LIVE_CALL_CAP) {
    throw new HybridCapError(
      `Hybrid pre-dispatch: ${estimatedCalls} live calls required (cap: ${HYBRID_LIVE_CALL_CAP}). ` +
      'Narrow the canonical base first.',
    );
  }

  // Step 3: apply live filter
  const filteredRows = await applyLiveFilter(baseResult.rows, liveFilters, plan, context);

  // Step 4: truncate to plan.limit
  const truncated = filteredRows.length > plan.limit;
  const rows = truncated ? filteredRows.slice(0, plan.limit) : filteredRows;

  return {
    rows,
    rowCount:         rows.length,
    truncated,
    truncationReason: truncated ? 'result_limit' : undefined,
    actualCostCents:  baseResult.actualCostCents, // live calls are cost-free in v1
    source:           'hybrid',
    providerLatencyMs: baseResult.providerLatencyMs,
  };
}
