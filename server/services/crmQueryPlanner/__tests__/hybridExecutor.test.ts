/**
 * hybridExecutor.test.ts — spec §14.4
 *
 * Tests hybrid plan splitting and cap enforcement.
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/hybridExecutor.test.ts
 */
import { expect, test } from 'vitest';
import { splitHybridPlan, HybridCapError, HybridLiveCallError } from '../executors/hybridExecutorPure.js';
import type { QueryPlan } from '../../../../shared/types/crmQueryPlanner.js';

function assertEqual<T>(a: T, b: T, label = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlan(overrides: Partial<QueryPlan>): QueryPlan {
  return {
    source:               'hybrid',
    intentClass:          'list_entities',
    primaryEntity:        'contacts',
    filters:              [],
    limit:                50,
    canonicalCandidateKey: 'contacts.inactive_over_days',
    confidence:           0.85,
    stageResolved:        3,
    hybridPattern:        'canonical_base_with_live_filter',
    costPreview:          { predictedCostCents: 5, confidence: 'medium', basedOn: 'planner_estimate' },
    validated:            true,
    ...overrides,
  } as QueryPlan;
}

// ── splitHybridPlan tests ─────────────────────────────────────────────────────

test('canonical filters stay in canonicalBase', () => {
  const plan = makePlan({
    filters: [
      { field: 'lastActivityAt', operator: 'lt', value: '2026-01-01', humanLabel: 'Inactive since' },
      { field: 'email',          operator: 'contains', value: '@acme.com', humanLabel: 'Email contains' },
    ],
  });
  const { canonicalBase, liveFilters } = splitHybridPlan(plan);
  expect(canonicalBase.filters.length, 'canonical filters count').toBe(2);
  expect(liveFilters.length, 'no live filters').toBe(0);
});

test('live-only fields routed to liveFilters', () => {
  const plan = makePlan({
    filters: [
      { field: 'lastActivityAt', operator: 'lt',       value: '2026-01-01', humanLabel: 'inactive' },
      { field: 'city',           operator: 'eq',       value: 'London',     humanLabel: 'city = London' },
    ],
  });
  const { canonicalBase, liveFilters } = splitHybridPlan(plan);
  expect(canonicalBase.filters.length, 'one canonical filter').toBe(1);
  expect(liveFilters.length, 'one live filter').toBe(1);
  expect(liveFilters[0]!.field).toBe('city');
});

test('canonicalBase source is forced to canonical', () => {
  const plan = makePlan({ source: 'hybrid' });
  const { canonicalBase } = splitHybridPlan(plan);
  expect(canonicalBase.source, 'canonicalBase.source').toBe('canonical');
});

test('multiple live-only fields all routed to liveFilters', () => {
  const plan = makePlan({
    filters: [
      { field: 'city',         operator: 'eq', value: 'London', humanLabel: 'city' },
      { field: 'country',      operator: 'eq', value: 'GB',     humanLabel: 'country' },
      { field: 'customFields', operator: 'eq', value: 'X',      humanLabel: 'custom' },
    ],
  });
  const { liveFilters } = splitHybridPlan(plan);
  expect(liveFilters.length, 'all 3 are live-only').toBe(3);
});

// ── HybridCapError ────────────────────────────────────────────────────────────

test('HybridCapError is instanceof Error', () => {
  const err = new HybridCapError('cap reached');
  expect(err instanceof Error, 'should be Error').toBeTruthy();
  expect(err.errorCode).toBe('cost_exceeded');
});

// ── Non-hybrid / wrong pattern guards (testing exported contract) ─────────────

test('HybridLiveCallError has correct errorCode', () => {
  const err = new HybridLiveCallError('test');
  expect(err instanceof Error, 'should be Error').toBeTruthy();
  expect(err.errorCode).toBe('live_call_failed');
});

// ── Summary ───────────────────────────────────────────────────────────────────
