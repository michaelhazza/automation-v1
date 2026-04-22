/**
 * orgConfigServiceReadPathPure.test.ts
 *
 * Regression test for the Session 1 / contract (h) read-path retarget — the
 * pr-reviewer round caught that `orgConfigService.getOperationalConfig`
 * was still reading from `hierarchyTemplates.operationalConfigSeed` after
 * the write path had been moved to `organisations.operational_config_override`.
 *
 * This pure test pins down the decoder semantics that the service must
 * preserve: override wins on primitive leaves, nested objects recurse,
 * array leaves replace wholesale, null override returns system defaults
 * untouched, both-null returns {}. The service-level integration that wires
 * `resolveEffectiveOperationalConfig` to the real Drizzle queries is
 * covered by the existing DB-fixture test in Session 2.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/orgConfigServiceReadPathPure.test.ts
 */

import { resolveEffectiveOperationalConfig } from '../orgOperationalConfigMigrationPure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}`); console.log(`        ${err instanceof Error ? err.message : err}`); }
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

console.log('orgConfigServiceReadPathPure');

// Regression case (maps to spec ship gate S1-A1): the classic scenario the
// original bug would have broken — override present on `alertLimits.maxPerRun`,
// sibling inherited from system defaults.
test('S1-A1: override present on one leaf inherits siblings from system defaults', () => {
  const systemDefaults = {
    alertLimits: { maxPerRun: 20, maxAlertsPerAccountPerDay: 3 },
    healthScoreFactors: [{ slug: 'x', weight: 1.0 }],
  };
  const override = {
    alertLimits: { maxPerRun: 5 },
  };
  const result = resolveEffectiveOperationalConfig(systemDefaults, override);
  assert(
    deepEqual(result, {
      alertLimits: { maxPerRun: 5, maxAlertsPerAccountPerDay: 3 },
      healthScoreFactors: [{ slug: 'x', weight: 1.0 }],
    }),
    `expected override-wins + sibling inherit, got ${JSON.stringify(result)}`,
  );
});

// Additional regression: the legacy pre-Session-1 case where the org has a
// non-null override but no adopted system template (systemDefaults = null).
test('legacy org: null systemDefaults + non-null override returns override intact', () => {
  const override = { churnBands: { healthy: [75, 100], watch: [50, 74] } };
  const result = resolveEffectiveOperationalConfig(null, override);
  assert(deepEqual(result, override), 'expected override as-is');
});

// Both null — fresh org with no template and no overrides (shouldn't happen
// in practice but the decoder must not throw).
test('brand-new org: null systemDefaults + null override returns {}', () => {
  const result = resolveEffectiveOperationalConfig(null, null);
  assert(deepEqual(result, {}), 'expected {}');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
