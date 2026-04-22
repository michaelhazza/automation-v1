/**
 * canonicalQueryRegistry.test.ts — spec §12.4
 *
 * Tests pure registry metadata (no DB deps — safe to run with tsx).
 * Handler binding is covered by integration tests.
 *
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/canonicalQueryRegistry.test.ts
 */
import { REGISTRY_META } from '../executors/canonicalQueryRegistryMeta.js';

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

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(label);
}

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
  assertEqual(Object.keys(REGISTRY_META).length, 8, 'entry count');
});

test('all expected keys are present', () => {
  for (const key of EXPECTED_KEYS) {
    assert(key in REGISTRY_META, `missing key: ${key}`);
  }
});

// ── Per-entry invariants ──────────────────────────────────────────────────

for (const key of EXPECTED_KEYS) {
  test(`${key}: entry.key matches object key`, () => {
    assertEqual(REGISTRY_META[key]!.key, key, 'key consistency');
  });

  test(`${key}: has at least one alias`, () => {
    assert((REGISTRY_META[key]!.aliases.length) > 0, 'aliases must not be empty');
  });

  test(`${key}: requiredCapabilities is an array`, () => {
    assert(Array.isArray(REGISTRY_META[key]!.requiredCapabilities), 'requiredCapabilities must be array');
  });

  test(`${key}: allowedFields is an object with at least one field`, () => {
    assert(Object.keys(REGISTRY_META[key]!.allowedFields).length > 0, 'allowedFields must not be empty');
  });

  test(`${key}: description is non-empty string`, () => {
    assert(typeof REGISTRY_META[key]!.description === 'string' && REGISTRY_META[key]!.description.length > 0, 'description must be non-empty string');
  });

  test(`${key}: primaryEntity is a valid entity`, () => {
    const validEntities = ['contacts', 'opportunities', 'appointments', 'conversations', 'revenue', 'tasks'];
    assert(validEntities.includes(REGISTRY_META[key]!.primaryEntity), `primaryEntity must be one of ${validEntities.join(', ')}`);
  });
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
