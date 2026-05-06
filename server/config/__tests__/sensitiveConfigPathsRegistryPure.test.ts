/**
 * sensitiveConfigPathsRegistryPure.test.ts
 *
 * Covers contract (n) / locked-registry pattern from spec §1.3:
 *   - Modules register paths via `registerSensitiveConfigPaths`; the registry
 *     merges across modules with no duplication (Set semantics).
 *   - `isSensitiveConfigPath` returns true for exact matches and prefix
 *     matches (`foo.bar` matches `foo.bar.baz`).
 *   - `getAllSensitiveConfigPaths` surfaces the merged set.
 *   - The registry is append-only within a process — adding the same path
 *     twice is a no-op; no API for silent removal.
 *
 * Runnable via:
 *   npx tsx server/config/__tests__/sensitiveConfigPathsRegistryPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  registerSensitiveConfigPaths,
  getAllSensitiveConfigPaths,
  isSensitiveConfigPath,
  __resetSensitiveConfigPathsRegistryForTests,
} from '../sensitiveConfigPathsRegistry.js';

console.log('sensitiveConfigPathsRegistryPure');

// Case 1 — empty registry returns empty set + nothing is sensitive.
test('empty registry: no paths sensitive', () => {
  __resetSensitiveConfigPathsRegistryForTests();
  expect(getAllSensitiveConfigPaths().length === 0, 'expected empty set').toBeTruthy();
  expect(isSensitiveConfigPath('anything.at.all') === false, 'expected false').toBeTruthy();
});

// Case 2 — registered path matches exactly.
test('exact match resolves sensitive', () => {
  __resetSensitiveConfigPathsRegistryForTests();
  registerSensitiveConfigPaths('m1', ['alertLimits.maxPerRun']);
  expect(isSensitiveConfigPath('alertLimits.maxPerRun') === true, 'exact path').toBeTruthy();
});

// Case 3 — prefix match resolves sensitive (matches `foo.bar` against `foo.bar.baz`).
test('prefix match resolves sensitive', () => {
  __resetSensitiveConfigPathsRegistryForTests();
  registerSensitiveConfigPaths('m1', ['interventionDefaults']);
  expect(isSensitiveConfigPath('interventionDefaults.cooldownHours') === true, 'prefix').toBeTruthy();
  expect(isSensitiveConfigPath('interventionDefaults.anything.deeper') === true, 'deeper prefix').toBeTruthy();
});

// Case 4 — sibling paths do NOT match a registered path.
test('sibling paths are not sensitive', () => {
  __resetSensitiveConfigPathsRegistryForTests();
  registerSensitiveConfigPaths('m1', ['healthScoreFactors']);
  expect(isSensitiveConfigPath('healthScoreFactorsExtra') === false, 'sibling with shared prefix').toBeTruthy();
  expect(isSensitiveConfigPath('churnBands') === false, 'unrelated sibling').toBeTruthy();
});

// Case 5 — multiple modules merge without duplication.
test('multi-module merge', () => {
  __resetSensitiveConfigPathsRegistryForTests();
  registerSensitiveConfigPaths('m1', ['pathA', 'pathB']);
  registerSensitiveConfigPaths('m2', ['pathC']);
  const all = getAllSensitiveConfigPaths();
  expect(all.length === 3, `expected 3 paths, got ${all.length}`).toBeTruthy();
  expect(all.includes('pathA'), 'includes pathA').toBeTruthy();
  expect(all.includes('pathB'), 'includes pathB').toBeTruthy();
  expect(all.includes('pathC'), 'includes pathC').toBeTruthy();
});

// Case 6 — re-registering the same path is a no-op (Set semantics).
test('duplicate registrations are no-ops', () => {
  __resetSensitiveConfigPathsRegistryForTests();
  registerSensitiveConfigPaths('m1', ['dup']);
  registerSensitiveConfigPaths('m2', ['dup']);
  registerSensitiveConfigPaths('m3', ['dup']);
  expect(getAllSensitiveConfigPaths().length === 1, 'single entry').toBeTruthy();
});

// Case 7 — empty string and non-path inputs handled cleanly.
test('empty string is not sensitive', () => {
  __resetSensitiveConfigPathsRegistryForTests();
  registerSensitiveConfigPaths('m1', ['x']);
  expect(isSensitiveConfigPath('') === false, 'empty string').toBeTruthy();
});

// Case 8 — ClientPulse module registration ships the expected 14 paths.
test('ClientPulse module registers 14 sensitive paths', async () => {
  __resetSensitiveConfigPathsRegistryForTests();
  // Side-effecting import — mirrors server/index.ts boot behaviour.
  await import('../../modules/clientpulse/registerSensitivePaths.js');
  const all = getAllSensitiveConfigPaths();
  expect(all.length === 14, `expected 14 ClientPulse paths, got ${all.length}: ${JSON.stringify(all)}`).toBeTruthy();
  expect(all.includes('interventionDefaults.defaultGateLevel'), 'includes defaultGateLevel').toBeTruthy();
  expect(all.includes('dataRetention'), 'includes dataRetention').toBeTruthy();
  expect(isSensitiveConfigPath('dataRetention.metricHistoryDays') === true, 'dataRetention prefix').toBeTruthy();
});