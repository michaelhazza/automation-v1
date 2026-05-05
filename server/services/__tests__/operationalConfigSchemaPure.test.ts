/**
 * operationalConfigSchemaPure.test.ts — Pure tests for ClientPulse operational
 * config Zod schema + sensitive-path enumeration. Ship-gate B4.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/operationalConfigSchemaPure.test.ts
 */

// Session 1: side-effect import populates the sensitive-paths registry with
// ClientPulse's paths before any isSensitiveConfigPath assertion runs. See
// spec §3.6 + the module-composable registry pattern.
import { expect, test } from 'vitest';
import '../../modules/clientpulse/registerSensitivePaths.js';

import {
  validateOperationalConfig,
  isSensitiveConfigPath,
  getSensitiveConfigPaths,
  staffActivityDefinitionSchema,
  churnBandsSchema,
  interventionDefaultsSchema,
} from '../operationalConfigSchema.js';

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
  expect(r.success, `expected success, got ${JSON.stringify(r)}`).toBeTruthy();
});

test('staffActivityDefinitionSchema rejects empty countedMutationTypes', () => {
  const r = staffActivityDefinitionSchema.safeParse({ ...validStaffActivity, countedMutationTypes: [] });
  expect(!r.success, 'expected failure').toBeTruthy();
});

test('staffActivityDefinitionSchema rejects threshold > 1', () => {
  const r = staffActivityDefinitionSchema.safeParse({
    ...validStaffActivity,
    automationUserResolution: { strategy: 'outlier_by_volume', threshold: 1.5, cacheMonths: 1 },
  });
  expect(!r.success, 'expected failure').toBeTruthy();
});

test('churnBandsSchema accepts valid bands', () => {
  const r = churnBandsSchema.safeParse(validChurnBands);
  expect(r.success, 'expected success').toBeTruthy();
});

test('churnBandsSchema rejects inverted band (low > high)', () => {
  const r = churnBandsSchema.safeParse({ ...validChurnBands, watch: [69, 40] });
  expect(!r.success, 'expected failure — watch band is inverted').toBeTruthy();
});

test('interventionDefaultsSchema accepts seeded default', () => {
  const r = interventionDefaultsSchema.safeParse(validInterventionDefaults);
  expect(r.success, 'expected success').toBeTruthy();
});

test('interventionDefaultsSchema rejects unknown cooldownScope', () => {
  const r = interventionDefaultsSchema.safeParse({ ...validInterventionDefaults, cooldownScope: 'bogus' });
  expect(!r.success, 'expected failure').toBeTruthy();
});

// ── Tests: full operational_config + sum constraint ────────────────────────

test('validateOperationalConfig accepts minimal config with ClientPulse keys', () => {
  const r = validateOperationalConfig({
    staffActivity: validStaffActivity,
    churnBands: validChurnBands,
    interventionDefaults: validInterventionDefaults,
  });
  expect(r.ok, 'expected ok').toBeTruthy();
});

test('validateOperationalConfig accepts empty config (all keys optional)', () => {
  const r = validateOperationalConfig({});
  expect(r.ok, 'expected ok').toBeTruthy();
});

test('validateOperationalConfig enforces healthScoreFactors weights sum to 1.0', () => {
  const r = validateOperationalConfig({
    healthScoreFactors: [
      { metricSlug: 'a', weight: 0.3, label: 'A', normalisation: { type: 'linear', minValue: 0, maxValue: 1 } },
      { metricSlug: 'b', weight: 0.3, label: 'B', normalisation: { type: 'linear', minValue: 0, maxValue: 1 } },
    ],
  });
  expect(!r.ok, 'expected failure on weight sum 0.6').toBeTruthy();
});

test('validateOperationalConfig accepts weights that sum exactly to 1.0', () => {
  const r = validateOperationalConfig({
    healthScoreFactors: [
      { metricSlug: 'a', weight: 0.5, label: 'A', normalisation: { type: 'linear', minValue: 0, maxValue: 1 } },
      { metricSlug: 'b', weight: 0.5, label: 'B', normalisation: { type: 'linear', minValue: 0, maxValue: 1 } },
    ],
  });
  expect(r.ok, 'expected ok').toBeTruthy();
});

test('validateOperationalConfig passes through unknown top-level keys (loose base)', () => {
  const r = validateOperationalConfig({ scanFrequencyHours: 4, maxAccountsPerRun: 50 });
  expect(r.ok, 'expected ok').toBeTruthy();
});

// ── Tests: sensitive paths registry ────────────────────────────────────────
//
// Session 1: sensitive paths moved to the module-composable registry per
// spec §3.6. The deprecated SENSITIVE_CONFIG_PATHS frozen-array export was
// replaced by getSensitiveConfigPaths() (function-backed alias returning a
// snapshot of the current registry state).

test('getSensitiveConfigPaths includes interventionDefaults.defaultGateLevel', () => {
  expect(getSensitiveConfigPaths().includes('interventionDefaults.defaultGateLevel'), 'missing path').toBeTruthy();
});

test('getSensitiveConfigPaths returns a snapshot (mutations do not leak into registry)', () => {
  const snapshot = getSensitiveConfigPaths() as unknown as string[];
  snapshot.push('bogus-caller-mutation');
  const fresh = getSensitiveConfigPaths();
  expect(!fresh.includes('bogus-caller-mutation'), 'caller mutation leaked into registry').toBeTruthy();
});

test('isSensitiveConfigPath matches exact sensitive path', () => {
  expect(isSensitiveConfigPath('interventionDefaults.defaultGateLevel'), 'should match').toBeTruthy();
});

test('isSensitiveConfigPath matches deeper sub-path of a sensitive prefix', () => {
  expect(isSensitiveConfigPath('healthScoreFactors.0.weight'), 'should match under healthScoreFactors prefix').toBeTruthy();
});

test('isSensitiveConfigPath rejects non-sensitive path', () => {
  expect(!isSensitiveConfigPath('scanFrequencyHours'), 'should not match').toBeTruthy();
});

test('isSensitiveConfigPath rejects sibling prefix not in list', () => {
  expect(!isSensitiveConfigPath('interventionDefaults'), 'exact prefix without dot should not match').toBeTruthy();
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log('');
