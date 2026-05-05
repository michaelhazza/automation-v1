/**
 * canonicalQueryRegistry.test.ts — spec §12.4
 *
 * Tests pure registry metadata (no DB deps — safe to run with tsx).
 * Handler binding is covered by integration tests.
 *
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/canonicalQueryRegistry.test.ts
 */
import { expect, test } from 'vitest';
import { REGISTRY_META } from '../executors/canonicalQueryRegistryMeta.js';

function assertEqual<T>(a: T, b: T, label = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

const EXPECTED_KEYS = [
  'contacts.inactive_over_days',
  'accounts.at_risk_band',
  'opportunities.pipeline_velocity',
  'opportunities.stale_over_days',
  'appointments.upcoming',
  'contacts.count_by_tag',
  'opportunities.count_by_stage',
  'revenue.trend_over_range',
];

// ── Structural ────────────────────────────────────────────────────────────

test('REGISTRY_META has exactly 8 v1 entries', () => {
  expect(Object.keys(REGISTRY_META).length, 'entry count').toBe(8);
});

test('all expected keys are present', () => {
  for (const key of EXPECTED_KEYS) {
    expect(key in REGISTRY_META, `missing key: ${key}`).toBeTruthy();
  }
});

// ── Per-entry invariants ──────────────────────────────────────────────────

for (const key of EXPECTED_KEYS) {
  test(`${key}: entry.key matches object key`, () => {
    expect(REGISTRY_META[key]!.key, 'key consistency').toEqual(key);
  });

  test(`${key}: has at least one alias`, () => {
    expect((REGISTRY_META[key]!.aliases.length) > 0, 'aliases must not be empty').toBeTruthy();
  });

  test(`${key}: requiredCapabilities is an array`, () => {
    expect(Array.isArray(REGISTRY_META[key]!.requiredCapabilities), 'requiredCapabilities must be array').toBeTruthy();
  });

  test(`${key}: allowedFields is an object with at least one field`, () => {
    expect(Object.keys(REGISTRY_META[key]!.allowedFields).length > 0, 'allowedFields must not be empty').toBeTruthy();
  });

  test(`${key}: description is non-empty string`, () => {
    expect(typeof REGISTRY_META[key]!.description === 'string' && REGISTRY_META[key]!.description.length > 0, 'description must be non-empty string').toBeTruthy();
  });

  test(`${key}: primaryEntity is a valid entity`, () => {
    const validEntities = ['contacts', 'opportunities', 'appointments', 'conversations', 'revenue', 'tasks'];
    expect(validEntities.includes(REGISTRY_META[key]!.primaryEntity), `primaryEntity must be one of ${validEntities.join(', ')}`).toBeTruthy();
  });
}

// ── Summary ───────────────────────────────────────────────────────────────
