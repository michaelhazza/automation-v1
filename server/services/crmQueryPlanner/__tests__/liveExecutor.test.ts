/**
 * liveExecutor.test.ts — spec §13.6
 *
 * Tests pure plan translation and mock-based executor behaviour.
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/liveExecutor.test.ts
 */

// We test translateToProviderQuery from liveExecutorPure (pure — no axios dependency).
// For the full executeLive path, adapter calls are mocked at the service level.

import { translateToProviderQuery } from '../executors/liveExecutorPure.js';
import type { QueryPlan, ExecutorContext } from '../../../../shared/types/crmQueryPlanner.js';

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

// ── Minimal plan builder ──────────────────────────────────────────────────────

function makePlan(overrides: Partial<QueryPlan>): QueryPlan {
  return {
    source:               'live',
    intentClass:          'list_entities',
    primaryEntity:        'contacts',
    filters:              [],
    limit:                50,
    canonicalCandidateKey: null,
    confidence:           0.9,
    stageResolved:        3,
    costPreview:          { predictedCostCents: 0, confidence: 'high', basedOn: 'static_heuristic' },
    validated:            true,
    ...overrides,
  } as QueryPlan;
}

// ── Translation tests ─────────────────────────────────────────────────────────

test('contacts plan → listContacts endpoint', () => {
  const plan = makePlan({ primaryEntity: 'contacts', limit: 30 });
  const t = translateToProviderQuery(plan);
  assertEqual(t.endpoint, 'listContacts');
  assertEqual(t.params.limit, 30);
});

test('opportunities plan → listOpportunities endpoint', () => {
  const plan = makePlan({ primaryEntity: 'opportunities', limit: 25 });
  const t = translateToProviderQuery(plan);
  assertEqual(t.endpoint, 'listOpportunities');
  assertEqual(t.params.limit, 25);
});

test('appointments plan → listAppointments endpoint', () => {
  const plan = makePlan({ primaryEntity: 'appointments', limit: 10 });
  const t = translateToProviderQuery(plan);
  assertEqual(t.endpoint, 'listAppointments');
  assertEqual(t.params.limit, 10);
});

test('conversations plan → listConversations endpoint', () => {
  const plan = makePlan({ primaryEntity: 'conversations', limit: 20 });
  const t = translateToProviderQuery(plan);
  assertEqual(t.endpoint, 'listConversations');
});

test('tasks plan → listTasks endpoint', () => {
  const plan = makePlan({ primaryEntity: 'tasks', limit: 15 });
  const t = translateToProviderQuery(plan);
  assertEqual(t.endpoint, 'listTasks');
});

test('dateContext from/to populate startDate/endDate for appointments', () => {
  const plan = makePlan({
    primaryEntity: 'appointments',
    dateContext: { kind: 'absolute', from: '2026-04-01', to: '2026-04-30' },
  });
  const t = translateToProviderQuery(plan);
  assertEqual(t.params.startDate, '2026-04-01');
  assertEqual(t.params.endDate,   '2026-04-30');
});

test('status filter extracted for opportunities', () => {
  const plan = makePlan({
    primaryEntity: 'opportunities',
    filters: [{ field: 'status', operator: 'eq', value: 'open', humanLabel: 'Status: open' }],
  });
  const t = translateToProviderQuery(plan);
  assertEqual(t.params.status, 'open');
});

test('status filter extracted for conversations', () => {
  const plan = makePlan({
    primaryEntity: 'conversations',
    filters: [{ field: 'status', operator: 'eq', value: 'unread', humanLabel: 'Status: unread' }],
  });
  const t = translateToProviderQuery(plan);
  assertEqual(t.params.status, 'unread');
});

test('non-live plan: translateToProviderQuery still maps entity correctly (guard is in executeLive)', () => {
  // translateToProviderQuery doesn't check source — that guard lives in executeLive.
  // We verify the translation still produces a valid endpoint for a non-live plan
  // (the guard check in executeLive is integration-tested via crmQueryPlannerService.test.ts).
  const plan = makePlan({ source: 'canonical', primaryEntity: 'contacts', limit: 10 });
  const t = translateToProviderQuery(plan);
  assert(t.endpoint === 'listContacts', `expected listContacts, got ${t.endpoint}`);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
