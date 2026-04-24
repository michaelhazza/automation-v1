/**
 * hybridExecutor.test.ts — spec §14.4
 *
 * Tests hybrid plan splitting and cap enforcement.
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/hybridExecutor.test.ts
 */
import { splitHybridPlan, HybridCapError, HybridLiveCallError } from '../executors/hybridExecutorPure.js';
import type { QueryPlan } from '../../../../shared/types/crmQueryPlanner.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(label);
}

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
  assertEqual(canonicalBase.filters.length, 2, 'canonical filters count');
  assertEqual(liveFilters.length, 0, 'no live filters');
});

test('live-only fields routed to liveFilters', () => {
  const plan = makePlan({
    filters: [
      { field: 'lastActivityAt', operator: 'lt',       value: '2026-01-01', humanLabel: 'inactive' },
      { field: 'city',           operator: 'eq',       value: 'London',     humanLabel: 'city = London' },
    ],
  });
  const { canonicalBase, liveFilters } = splitHybridPlan(plan);
  assertEqual(canonicalBase.filters.length, 1, 'one canonical filter');
  assertEqual(liveFilters.length, 1, 'one live filter');
  assertEqual(liveFilters[0]!.field, 'city');
});

test('canonicalBase source is forced to canonical', () => {
  const plan = makePlan({ source: 'hybrid' });
  const { canonicalBase } = splitHybridPlan(plan);
  assertEqual(canonicalBase.source, 'canonical', 'canonicalBase.source');
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
  assertEqual(liveFilters.length, 3, 'all 3 are live-only');
});

// ── HybridCapError ────────────────────────────────────────────────────────────

test('HybridCapError is instanceof Error', () => {
  const err = new HybridCapError('cap reached');
  assert(err instanceof Error, 'should be Error');
  assertEqual(err.errorCode, 'cost_exceeded');
});

// ── Non-hybrid / wrong pattern guards (testing exported contract) ─────────────

test('HybridLiveCallError has correct errorCode', () => {
  const err = new HybridLiveCallError('test');
  assert(err instanceof Error, 'should be Error');
  assertEqual(err.errorCode, 'live_call_failed');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
