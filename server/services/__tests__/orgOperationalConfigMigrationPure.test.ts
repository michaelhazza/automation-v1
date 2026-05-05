/**
 * orgOperationalConfigMigrationPure.test.ts
 *
 * Covers contract (h) in spec §1.3 — effective operational config is derived
 * by deep-merging `systemHierarchyTemplates.operationalDefaults` (nullable)
 * with `organisations.operational_config_override` (nullable). Object leaves
 * merge recursively; array leaves replace wholesale; primitive leaves replace.
 *
 * Locks the semantics of the Session 1 data-model separation (§2 / contract
 * (h)) before Chunk A.2 retargets the live service; the pure decoder must
 * never re-interpret these cases.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/orgOperationalConfigMigrationPure.test.ts
 */

import { expect, test } from 'vitest';
import { resolveEffectiveOperationalConfig } from '../orgOperationalConfigMigrationPure.js';

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

console.log('orgOperationalConfigMigrationPure');

// Case 1 — null override returns systemDefaults untouched.
test('null override returns systemDefaults untouched', () => {
  const systemDefaults = { a: 1, nested: { x: 'sys' } };
  const result = resolveEffectiveOperationalConfig(systemDefaults, null);
  expect(deepEqual(result, systemDefaults), `expected systemDefaults, got ${JSON.stringify(result)}`).toBeTruthy();
});

// Case 2 — null systemDefaults + non-null override returns override as-is
//           (legacy pre-Session-1 org case per spec §4.5).
test('null systemDefaults + non-null override returns override as-is', () => {
  const overrides = { a: 2, nested: { x: 'override' } };
  const result = resolveEffectiveOperationalConfig(null, overrides);
  expect(deepEqual(result, overrides), `expected overrides, got ${JSON.stringify(result)}`).toBeTruthy();
});

// Case 3 — both null returns empty object.
test('both null returns {}', () => {
  const result = resolveEffectiveOperationalConfig(null, null);
  expect(deepEqual(result, {}), `expected {}, got ${JSON.stringify(result)}`).toBeTruthy();
});

// Case 4 — deep-merge precedence: override wins on primitive leaves,
//           object leaves recurse, siblings preserved.
test('deep-merge: override wins on primitives; nested objects recurse; siblings preserved', () => {
  const systemDefaults = {
    alertLimits: { maxPerRun: 100, batchLowPriority: false },
    healthScoreFactors: { stable: 'default' },
  };
  const overrides = {
    alertLimits: { maxPerRun: 50 },
  };
  const result = resolveEffectiveOperationalConfig(systemDefaults, overrides);
  expect(deepEqual(result, {
      alertLimits: { maxPerRun: 50, batchLowPriority: false },
      healthScoreFactors: { stable: 'default' },
    }), `expected deep-merge, got ${JSON.stringify(result)}`).toBeTruthy();
});

// Case 5 — array leaves replace wholesale (not concatenate).
test('array leaves replace wholesale', () => {
  const systemDefaults = { channels: ['in_app', 'email'] };
  const overrides = { channels: ['slack'] };
  const result = resolveEffectiveOperationalConfig(systemDefaults, overrides);
  expect(deepEqual(result, { channels: ['slack'] }), `expected wholesale replace, got ${JSON.stringify(result)}`).toBeTruthy();
});

// Case 6 — empty-object override returns systemDefaults (empty merge is a no-op).
test('empty-object override is a no-op', () => {
  const systemDefaults = { a: 1, b: { c: 2 } };
  const result = resolveEffectiveOperationalConfig(systemDefaults, {});
  expect(deepEqual(result, systemDefaults), `expected systemDefaults, got ${JSON.stringify(result)}`).toBeTruthy();
});
