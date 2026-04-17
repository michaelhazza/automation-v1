/**
 * pulseConfigServicePure.test.ts — Pulse v1 config service pure tests.
 *
 * Tests the threshold defaults and currency constants without DB access.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/pulseConfigServicePure.test.ts
 */

import {
  PULSE_MAJOR_THRESHOLD_DEFAULTS,
  CURRENCY_DEFAULT,
  PULSE_MAJOR_THRESHOLD_MAX_MINOR,
} from '../../config/pulseThresholds.js';

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
  if (a !== b) throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

console.log('');
console.log('pulseConfigServicePure — Pulse v1');
console.log('');

// ── Default threshold values ──────────────────────────────────────

test('perActionMinor default is 5000 (AUD $50.00)', () => {
  assertEqual(PULSE_MAJOR_THRESHOLD_DEFAULTS.perActionMinor, 5000, 'perActionMinor');
});

test('perRunMinor default is 50000 (AUD $500.00)', () => {
  assertEqual(PULSE_MAJOR_THRESHOLD_DEFAULTS.perRunMinor, 50000, 'perRunMinor');
});

test('perRunMinor >= perActionMinor by default', () => {
  if (PULSE_MAJOR_THRESHOLD_DEFAULTS.perRunMinor < PULSE_MAJOR_THRESHOLD_DEFAULTS.perActionMinor) {
    throw new Error('perRunMinor must be >= perActionMinor');
  }
});

// ── Currency default ──────────────────────────────────────────────

test('default currency is AUD', () => {
  assertEqual(CURRENCY_DEFAULT, 'AUD', 'CURRENCY_DEFAULT');
});

test('default currency is a 3-char uppercase ISO 4217 code', () => {
  if (!/^[A-Z]{3}$/.test(CURRENCY_DEFAULT)) {
    throw new Error(`CURRENCY_DEFAULT '${CURRENCY_DEFAULT}' does not match ISO 4217 format`);
  }
});

// ── Threshold max ─────────────────────────────────────────────────

test('max threshold is 1_000_000 (AUD $10,000)', () => {
  assertEqual(PULSE_MAJOR_THRESHOLD_MAX_MINOR, 1_000_000, 'PULSE_MAJOR_THRESHOLD_MAX_MINOR');
});

test('defaults are within max threshold', () => {
  if (PULSE_MAJOR_THRESHOLD_DEFAULTS.perActionMinor > PULSE_MAJOR_THRESHOLD_MAX_MINOR) {
    throw new Error('perActionMinor exceeds max');
  }
  if (PULSE_MAJOR_THRESHOLD_DEFAULTS.perRunMinor > PULSE_MAJOR_THRESHOLD_MAX_MINOR) {
    throw new Error('perRunMinor exceeds max');
  }
});

// ── Report ────────────────────────────────────────────────────────

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
