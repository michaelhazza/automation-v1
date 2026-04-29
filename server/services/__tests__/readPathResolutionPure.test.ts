/**
 * readPathResolutionPure.test.ts — Canonical Data Platform P2A pure tests.
 *
 * Tests for the resolveReadPath pure function.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/readPathResolutionPure.test.ts
 */

import { expect, test } from 'vitest';
import { resolveReadPath, type ReadPathResolution } from '../readPathResolutionPure.js';
import type { ActionDefinition } from '../../config/actionRegistry.js';

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
  expect(result.source, 'source').toBe('canonical');
  expect(result.rationale, 'rationale').toBe(undefined);
});

test('action with readPath liveFetch resolves to liveFetch with rationale', () => {
  const result = resolveReadPath(makeAction({
    readPath: 'liveFetch',
    liveFetchRationale: 'Provider API — not yet migrated',
  }));
  expect(result.source, 'source').toBe('liveFetch');
  expect(result.rationale, 'rationale').toBe('Provider API — not yet migrated');
});

test('action with readPath none resolves to none', () => {
  const result = resolveReadPath(makeAction({ readPath: 'none' }));
  expect(result.source, 'source').toBe('none');
  expect(result.rationale, 'rationale').toBe(undefined);
});

test('action without readPath resolves to none', () => {
  const action = makeAction();
  // Simulate a legacy entry that somehow has no readPath
  delete (action as any).readPath;
  const result = resolveReadPath(action);
  expect(result.source, 'source').toBe('none');
});

test('liveFetch without rationale returns undefined rationale', () => {
  const result = resolveReadPath(makeAction({ readPath: 'liveFetch' }));
  expect(result.source, 'source').toBe('liveFetch');
  expect(result.rationale, 'rationale').toBe(undefined);
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log('');
