/**
 * readPathResolutionPure.test.ts — Canonical Data Platform P2A pure tests.
 *
 * Tests for the resolveReadPath pure function.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/readPathResolutionPure.test.ts
 */

import { resolveReadPath, type ReadPathResolution } from '../readPathResolutionPure.js';
import type { ActionDefinition } from '../../config/actionRegistry.js';

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

function assertEqual(a: unknown, b: unknown, label: string) {
  const aJson = JSON.stringify(a);
  const bJson = JSON.stringify(b);
  if (aJson !== bJson) throw new Error(`${label} — expected ${bJson}, got ${aJson}`);
}

/** Build a minimal ActionDefinition stub for testing. */
function makeAction(overrides: Partial<ActionDefinition> = {}): ActionDefinition {
  return {
    actionType: 'test_action',
    description: 'test',
    actionCategory: 'api',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: [],
    parameterSchema: {} as any,
    retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
    idempotencyStrategy: 'read_only',
    readPath: 'none',
    ...overrides,
  } as ActionDefinition;
}

console.log('');
console.log('readPathResolutionPure — Canonical Data Platform P2A');
console.log('');

// ── resolveReadPath ──────────────────────────────────────────────────────

test('action with readPath canonical resolves to canonical', () => {
  const result = resolveReadPath(makeAction({ readPath: 'canonical' }));
  assertEqual(result.source, 'canonical', 'source');
  assertEqual(result.rationale, undefined, 'rationale');
});

test('action with readPath liveFetch resolves to liveFetch with rationale', () => {
  const result = resolveReadPath(makeAction({
    readPath: 'liveFetch',
    liveFetchRationale: 'Provider API — not yet migrated',
  }));
  assertEqual(result.source, 'liveFetch', 'source');
  assertEqual(result.rationale, 'Provider API — not yet migrated', 'rationale');
});

test('action with readPath none resolves to none', () => {
  const result = resolveReadPath(makeAction({ readPath: 'none' }));
  assertEqual(result.source, 'none', 'source');
  assertEqual(result.rationale, undefined, 'rationale');
});

test('action without readPath resolves to none', () => {
  const action = makeAction();
  // Simulate a legacy entry that somehow has no readPath
  delete (action as any).readPath;
  const result = resolveReadPath(action);
  assertEqual(result.source, 'none', 'source');
});

test('liveFetch without rationale returns undefined rationale', () => {
  const result = resolveReadPath(makeAction({ readPath: 'liveFetch' }));
  assertEqual(result.source, 'liveFetch', 'source');
  assertEqual(result.rationale, undefined, 'rationale');
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
