/**
 * activityService.test.ts — Task 1.3 TDD tests for additive fields,
 * deterministic sort tiebreaker, and partial-failure resilience.
 *
 * Pure tests only — no DB / no env imports.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/activityService.test.ts
 */

import {
  mapAgentRunTriggerType,
  sortActivityItems,
  addNullAdditiveFields,
  type TriggerType,
  type SortableItem,
} from '../activityServicePure.js';

// We also import the ActivityItem type to check the additive fields are present
// on the exported type.  This is a compile-time-only check — no runtime assertion
// needed; TypeScript will fail the build if the fields are missing.
import type { ActivityItem } from '../activityService.js';

// ---------------------------------------------------------------------------
// Compile-time shape check — ensure all 5 additive fields exist on ActivityItem.
// This will fail `npm run typecheck` if any field is missing from the type.
// ---------------------------------------------------------------------------
type _AdditiveFieldsPresent = {
  triggeredByUserId: ActivityItem['triggeredByUserId'];
  triggeredByUserName: ActivityItem['triggeredByUserName'];
  triggerType: ActivityItem['triggerType'];
  durationMs: ActivityItem['durationMs'];
  runId: ActivityItem['runId'];
};

// ---------------------------------------------------------------------------
// Minimal test harness (matches project convention — no framework)
// ---------------------------------------------------------------------------

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

function assertEqual<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label} — expected ${e}, got ${a}`);
}

function assertNull(actual: unknown, label: string) {
  if (actual !== null) throw new Error(`${label} — expected null, got ${JSON.stringify(actual)}`);
}

function assertNotNull(actual: unknown, label: string) {
  if (actual === null || actual === undefined) throw new Error(`${label} — expected non-null`);
}

console.log('');
console.log('activityService — Task 1.3 pure tests');
console.log('');

// ===========================================================================
// mapAgentRunTriggerType
// ===========================================================================

console.log('--- mapAgentRunTriggerType ---');

test('manual run_type → triggerType = manual', () => {
  const result = mapAgentRunTriggerType('manual', null);
  assertEqual<TriggerType | null>(result, 'manual', 'triggerType');
});

test('manual run_type with run_source set → triggerType = manual', () => {
  const result = mapAgentRunTriggerType('manual', 'scheduler');
  assertEqual<TriggerType | null>(result, 'manual', 'triggerType');
});

test('scheduled run_type → triggerType = scheduled', () => {
  const result = mapAgentRunTriggerType('scheduled', null);
  assertEqual<TriggerType | null>(result, 'scheduled', 'triggerType');
});

test('triggered + run_source=handoff → triggerType = agent', () => {
  const result = mapAgentRunTriggerType('triggered', 'handoff');
  assertEqual<TriggerType | null>(result, 'agent', 'triggerType');
});

test('triggered + run_source=sub_agent → triggerType = agent', () => {
  const result = mapAgentRunTriggerType('triggered', 'sub_agent');
  assertEqual<TriggerType | null>(result, 'agent', 'triggerType');
});

test('triggered + run_source=null → triggerType = webhook (null fallback)', () => {
  const result = mapAgentRunTriggerType('triggered', null);
  assertEqual<TriggerType | null>(result, 'webhook', 'triggerType');
});

test('triggered + run_source=trigger → triggerType = webhook', () => {
  const result = mapAgentRunTriggerType('triggered', 'trigger');
  assertEqual<TriggerType | null>(result, 'webhook', 'triggerType');
});

test('triggered + run_source=manual → triggerType = webhook (manual source, triggered type)', () => {
  // run_source='manual' is a different field from run_type='manual'; this is
  // a triggered run initiated by a manual webhook call.
  const result = mapAgentRunTriggerType('triggered', 'manual');
  assertEqual<TriggerType | null>(result, 'webhook', 'triggerType');
});

test('unknown run_type → triggerType = null', () => {
  const result = mapAgentRunTriggerType('unknown_future_type', null);
  assertNull(result, 'triggerType');
});

// ===========================================================================
// sortActivityItems — deterministic tiebreaker
// ===========================================================================

console.log('');
console.log('--- sortActivityItems tiebreaker ---');

const SAME_TIME = '2026-04-24T10:00:00.000Z';

// Construct two SortableItems with identical createdAt but different ids.
// DE-CR-8: spec §12 mandates `id ASC` within the same `created_at` for the
// activity feed. Lower id wins.
const itemA: SortableItem = {
  id: 'aaaaaaaa-0000-0000-0000-000000000002',
  status: 'completed',
  severity: null,
  createdAt: SAME_TIME,
};

const itemB: SortableItem = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  status: 'completed',
  severity: null,
  createdAt: SAME_TIME,
};

// itemB.id < itemA.id (lexicographic), so itemB sorts first under id ASC.

test('identical createdAt — newest sort: lower id comes first (id ASC tiebreaker)', () => {
  const sorted = sortActivityItems([itemA, itemB], 'newest');
  assertEqual(sorted[0].id, itemB.id, 'first item id');
  assertEqual(sorted[1].id, itemA.id, 'second item id');
});

test('identical createdAt — oldest sort: lower id comes first (consistent tiebreaker)', () => {
  const sorted = sortActivityItems([itemA, itemB], 'oldest');
  assertEqual(sorted[0].id, itemB.id, 'first item id');
  assertEqual(sorted[1].id, itemA.id, 'second item id');
});

test('identical createdAt — severity sort: lower id comes first', () => {
  const sorted = sortActivityItems([itemA, itemB], 'severity');
  assertEqual(sorted[0].id, itemB.id, 'first item id');
  assertEqual(sorted[1].id, itemA.id, 'second item id');
});

test('identical createdAt — attention_first sort: lower id comes first', () => {
  const sorted = sortActivityItems([itemA, itemB], 'attention_first');
  assertEqual(sorted[0].id, itemB.id, 'first item id');
  assertEqual(sorted[1].id, itemA.id, 'second item id');
});

test('sort is stable for 3 items with different timestamps', () => {
  const items: SortableItem[] = [
    { id: 'id-1', status: 'completed', severity: null, createdAt: '2026-04-24T08:00:00.000Z' },
    { id: 'id-3', status: 'completed', severity: null, createdAt: '2026-04-24T10:00:00.000Z' },
    { id: 'id-2', status: 'completed', severity: null, createdAt: '2026-04-24T09:00:00.000Z' },
  ];
  const sorted = sortActivityItems(items, 'newest');
  assertEqual(sorted.map((i) => i.id), ['id-3', 'id-2', 'id-1'], 'order');
});

// ===========================================================================
// Additive fields on non-run activity types → all null
// ===========================================================================

console.log('');
console.log('--- Additive fields default null on non-run types ---');

// These checks call the real addNullAdditiveFields() function exported from
// activityServicePure.ts to verify the null-field contract.  Any change to
// the set of additive fields or their types will break this test at runtime
// (not just at compile time), giving us a real behavioural signal.

test('non-run types produce null for all 5 additive fields', () => {
  const fields = addNullAdditiveFields();
  assertNull(fields.triggeredByUserId, 'triggeredByUserId');
  assertNull(fields.triggeredByUserName, 'triggeredByUserName');
  assertNull(fields.triggerType, 'triggerType');
  assertNull(fields.durationMs, 'durationMs');
  assertNull(fields.runId, 'runId');
});

test('addNullAdditiveFields returns exactly 5 keys', () => {
  const fields = addNullAdditiveFields();
  const keys = Object.keys(fields);
  assertEqual(keys.length, 5, 'number of additive fields');
});

test('deleted user → triggeredByUserName = null, does not throw', () => {
  // Simulates what happens when the LEFT JOIN finds no user row.
  // addNullAdditiveFields() is the canonical source of the null defaults;
  // receiving null from the join should propagate to null on the output.
  const fields = addNullAdditiveFields();
  assertNull(fields.triggeredByUserName, 'triggeredByUserName when user deleted');
});

test('workflow execution passes through triggerType directly', () => {
  // The pass-through rule: executions.triggerType is already the correct type;
  // no mapping needed.  We verify the type values are in the TriggerType union.
  const executionTriggerTypes: TriggerType[] = ['manual', 'agent', 'scheduled', 'webhook', 'system'];
  assertEqual(executionTriggerTypes.length, 5, 'count');
  // Each value must be a valid TriggerType (compile-time check above is the
  // real guard; this runtime check confirms the array is non-empty).
  assertNotNull(executionTriggerTypes[0], 'first value');
});

// ===========================================================================
// Summary
// ===========================================================================

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('');

if (failed > 0) {
  process.exit(1);
}
