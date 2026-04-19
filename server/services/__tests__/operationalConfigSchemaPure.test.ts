/**
 * operationalConfigSchemaPure.test.ts — Pure tests for ClientPulse operational
 * config Zod schema + sensitive-path enumeration. Ship-gate B4.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/operationalConfigSchemaPure.test.ts
 */

import {
  validateOperationalConfig,
  isSensitiveConfigPath,
  SENSITIVE_CONFIG_PATHS,
  staffActivityDefinitionSchema,
  churnBandsSchema,
  interventionDefaultsSchema,
} from '../operationalConfigSchema.js';

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

// ── Fixtures ──────────────────────────────────────────────────────────────

const validStaffActivity = {
  countedMutationTypes: [
    { type: 'contact_created', weight: 1.0 },
    { type: 'workflow_edited', weight: 3.0 },
  ],
  excludedUserKinds: ['automation', 'contact'],
  automationUserResolution: { strategy: 'outlier_by_volume', threshold: 0.6, cacheMonths: 1 },
  lookbackWindowsDays: [7, 30, 90],
  churnFlagThresholds: { zeroActivityDays: 14, weekOverWeekDropPct: 50 },
};

const validChurnBands = {
  healthy: [70, 100] as [number, number],
  watch: [40, 69] as [number, number],
  atRisk: [20, 39] as [number, number],
  critical: [0, 19] as [number, number],
};

const validInterventionDefaults = {
  cooldownHours: 48,
  cooldownScope: 'executed',
  defaultGateLevel: 'review',
  maxProposalsPerDayPerSubaccount: 1,
  maxProposalsPerDayPerOrg: 20,
};

// ── Tests: individual block schemas ────────────────────────────────────────

test('staffActivityDefinitionSchema accepts the seeded default', () => {
  const r = staffActivityDefinitionSchema.safeParse(validStaffActivity);
  assert(r.success, `expected success, got ${JSON.stringify(r)}`);
});

test('staffActivityDefinitionSchema rejects empty countedMutationTypes', () => {
  const r = staffActivityDefinitionSchema.safeParse({ ...validStaffActivity, countedMutationTypes: [] });
  assert(!r.success, 'expected failure');
});

test('staffActivityDefinitionSchema rejects threshold > 1', () => {
  const r = staffActivityDefinitionSchema.safeParse({
    ...validStaffActivity,
    automationUserResolution: { strategy: 'outlier_by_volume', threshold: 1.5, cacheMonths: 1 },
  });
  assert(!r.success, 'expected failure');
});

test('churnBandsSchema accepts valid bands', () => {
  const r = churnBandsSchema.safeParse(validChurnBands);
  assert(r.success, 'expected success');
});

test('churnBandsSchema rejects inverted band (low > high)', () => {
  const r = churnBandsSchema.safeParse({ ...validChurnBands, watch: [69, 40] });
  assert(!r.success, 'expected failure — watch band is inverted');
});

test('interventionDefaultsSchema accepts seeded default', () => {
  const r = interventionDefaultsSchema.safeParse(validInterventionDefaults);
  assert(r.success, 'expected success');
});

test('interventionDefaultsSchema rejects unknown cooldownScope', () => {
  const r = interventionDefaultsSchema.safeParse({ ...validInterventionDefaults, cooldownScope: 'bogus' });
  assert(!r.success, 'expected failure');
});

// ── Tests: full operational_config + sum constraint ────────────────────────

test('validateOperationalConfig accepts minimal config with ClientPulse keys', () => {
  const r = validateOperationalConfig({
    staffActivity: validStaffActivity,
    churnBands: validChurnBands,
    interventionDefaults: validInterventionDefaults,
  });
  assert(r.ok, 'expected ok');
});

test('validateOperationalConfig accepts empty config (all keys optional)', () => {
  const r = validateOperationalConfig({});
  assert(r.ok, 'expected ok');
});

test('validateOperationalConfig enforces healthScoreFactors weights sum to 1.0', () => {
  const r = validateOperationalConfig({
    healthScoreFactors: [
      { metricSlug: 'a', weight: 0.3, label: 'A', normalisation: { type: 'linear', minValue: 0, maxValue: 1 } },
      { metricSlug: 'b', weight: 0.3, label: 'B', normalisation: { type: 'linear', minValue: 0, maxValue: 1 } },
    ],
  });
  assert(!r.ok, 'expected failure on weight sum 0.6');
});

test('validateOperationalConfig accepts weights that sum exactly to 1.0', () => {
  const r = validateOperationalConfig({
    healthScoreFactors: [
      { metricSlug: 'a', weight: 0.5, label: 'A', normalisation: { type: 'linear', minValue: 0, maxValue: 1 } },
      { metricSlug: 'b', weight: 0.5, label: 'B', normalisation: { type: 'linear', minValue: 0, maxValue: 1 } },
    ],
  });
  assert(r.ok, 'expected ok');
});

test('validateOperationalConfig passes through unknown top-level keys (loose base)', () => {
  const r = validateOperationalConfig({ scanFrequencyHours: 4, maxAccountsPerRun: 50 });
  assert(r.ok, 'expected ok');
});

// ── Tests: SENSITIVE_CONFIG_PATHS ──────────────────────────────────────────

test('SENSITIVE_CONFIG_PATHS includes interventionDefaults.defaultGateLevel', () => {
  assert(SENSITIVE_CONFIG_PATHS.includes('interventionDefaults.defaultGateLevel'), 'missing path');
});

test('SENSITIVE_CONFIG_PATHS is frozen (immutable at runtime)', () => {
  // Object.freeze makes the array immutable; attempting to mutate throws in strict mode.
  let threw = false;
  try {
    (SENSITIVE_CONFIG_PATHS as unknown as string[]).push('bogus');
  } catch {
    threw = true;
  }
  // In Node strict mode the push throws; in loose mode it silently no-ops. Either way the array stays unchanged.
  assert(threw || !SENSITIVE_CONFIG_PATHS.includes('bogus'), 'frozen array was mutated');
});

test('isSensitiveConfigPath matches exact sensitive path', () => {
  assert(isSensitiveConfigPath('interventionDefaults.defaultGateLevel'), 'should match');
});

test('isSensitiveConfigPath matches deeper sub-path of a sensitive prefix', () => {
  assert(isSensitiveConfigPath('healthScoreFactors.0.weight'), 'should match under healthScoreFactors prefix');
});

test('isSensitiveConfigPath rejects non-sensitive path', () => {
  assert(!isSensitiveConfigPath('scanFrequencyHours'), 'should not match');
});

test('isSensitiveConfigPath rejects sibling prefix not in list', () => {
  assert(!isSensitiveConfigPath('interventionDefaults'), 'exact prefix without dot should not match');
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log('');
console.log(`operationalConfigSchemaPure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
