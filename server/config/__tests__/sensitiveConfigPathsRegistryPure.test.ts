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

import {
  registerSensitiveConfigPaths,
  getAllSensitiveConfigPaths,
  isSensitiveConfigPath,
  __resetSensitiveConfigPathsRegistryForTests,
} from '../sensitiveConfigPathsRegistry.js';

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

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

console.log('sensitiveConfigPathsRegistryPure');

// Case 1 — empty registry returns empty set + nothing is sensitive.
test('empty registry: no paths sensitive', () => {
  __resetSensitiveConfigPathsRegistryForTests();
  assert(getAllSensitiveConfigPaths().length === 0, 'expected empty set');
  assert(isSensitiveConfigPath('anything.at.all') === false, 'expected false');
});

// Case 2 — registered path matches exactly.
test('exact match resolves sensitive', () => {
  __resetSensitiveConfigPathsRegistryForTests();
  registerSensitiveConfigPaths('m1', ['alertLimits.maxPerRun']);
  assert(isSensitiveConfigPath('alertLimits.maxPerRun') === true, 'exact path');
});

// Case 3 — prefix match resolves sensitive (matches `foo.bar` against `foo.bar.baz`).
test('prefix match resolves sensitive', () => {
  __resetSensitiveConfigPathsRegistryForTests();
  registerSensitiveConfigPaths('m1', ['interventionDefaults']);
  assert(isSensitiveConfigPath('interventionDefaults.cooldownHours') === true, 'prefix');
  assert(isSensitiveConfigPath('interventionDefaults.anything.deeper') === true, 'deeper prefix');
});

// Case 4 — sibling paths do NOT match a registered path.
test('sibling paths are not sensitive', () => {
  __resetSensitiveConfigPathsRegistryForTests();
  registerSensitiveConfigPaths('m1', ['healthScoreFactors']);
  assert(isSensitiveConfigPath('healthScoreFactorsExtra') === false, 'sibling with shared prefix');
  assert(isSensitiveConfigPath('churnBands') === false, 'unrelated sibling');
});

// Case 5 — multiple modules merge without duplication.
test('multi-module merge', () => {
  __resetSensitiveConfigPathsRegistryForTests();
  registerSensitiveConfigPaths('m1', ['pathA', 'pathB']);
  registerSensitiveConfigPaths('m2', ['pathC']);
  const all = getAllSensitiveConfigPaths();
  assert(all.length === 3, `expected 3 paths, got ${all.length}`);
  assert(all.includes('pathA'), 'includes pathA');
  assert(all.includes('pathB'), 'includes pathB');
  assert(all.includes('pathC'), 'includes pathC');
});

// Case 6 — re-registering the same path is a no-op (Set semantics).
test('duplicate registrations are no-ops', () => {
  __resetSensitiveConfigPathsRegistryForTests();
  registerSensitiveConfigPaths('m1', ['dup']);
  registerSensitiveConfigPaths('m2', ['dup']);
  registerSensitiveConfigPaths('m3', ['dup']);
  assert(getAllSensitiveConfigPaths().length === 1, 'single entry');
});

// Case 7 — empty string and non-path inputs handled cleanly.
test('empty string is not sensitive', () => {
  __resetSensitiveConfigPathsRegistryForTests();
  registerSensitiveConfigPaths('m1', ['x']);
  assert(isSensitiveConfigPath('') === false, 'empty string');
});

// Case 8 — ClientPulse module registration ships the expected 14 paths.
test('ClientPulse module registers 14 sensitive paths', async () => {
  __resetSensitiveConfigPathsRegistryForTests();
  // Side-effecting import — mirrors server/index.ts boot behaviour.
  await import('../../modules/clientpulse/registerSensitivePaths.js');
  const all = getAllSensitiveConfigPaths();
  assert(
    all.length === 14,
    `expected 14 ClientPulse paths, got ${all.length}: ${JSON.stringify(all)}`,
  );
  assert(all.includes('interventionDefaults.defaultGateLevel'), 'includes defaultGateLevel');
  assert(all.includes('dataRetention'), 'includes dataRetention');
  assert(isSensitiveConfigPath('dataRetention.metricHistoryDays') === true, 'dataRetention prefix');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
