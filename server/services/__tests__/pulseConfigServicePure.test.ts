/**
 * pulseConfigServicePure.test.ts — Pulse v1 config service pure tests.
 *
 * Tests the threshold defaults and currency constants without DB access.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/pulseConfigServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  PULSE_MAJOR_THRESHOLD_DEFAULTS,
  CURRENCY_DEFAULT,
  PULSE_MAJOR_THRESHOLD_MAX_MINOR,
} from '../../config/pulseThresholds.js';

console.log('');
console.log('pulseConfigServicePure — Pulse v1');
console.log('');

// ── Default threshold values ──────────────────────────────────────

test('perActionMinor default is 5000 (AUD $50.00)', () => {
  expect(PULSE_MAJOR_THRESHOLD_DEFAULTS.perActionMinor, 'perActionMinor').toBe(5000);
});

test('perRunMinor default is 50000 (AUD $500.00)', () => {
  expect(PULSE_MAJOR_THRESHOLD_DEFAULTS.perRunMinor, 'perRunMinor').toBe(50000);
});

test('perRunMinor >= perActionMinor by default', () => {
  if (PULSE_MAJOR_THRESHOLD_DEFAULTS.perRunMinor < PULSE_MAJOR_THRESHOLD_DEFAULTS.perActionMinor) {
    throw new Error('perRunMinor must be >= perActionMinor');
  }
});

// ── Currency default ──────────────────────────────────────────────

test('default currency is AUD', () => {
  expect(CURRENCY_DEFAULT, 'CURRENCY_DEFAULT').toBe('AUD');
});

test('default currency is a 3-char uppercase ISO 4217 code', () => {
  if (!/^[A-Z]{3}$/.test(CURRENCY_DEFAULT)) {
    throw new Error(`CURRENCY_DEFAULT '${CURRENCY_DEFAULT}' does not match ISO 4217 format`);
  }
});

// ── Threshold max ─────────────────────────────────────────────────

test('max threshold is 1_000_000 (AUD $10,000)', () => {
  expect(PULSE_MAJOR_THRESHOLD_MAX_MINOR, 'PULSE_MAJOR_THRESHOLD_MAX_MINOR').toEqual(1_000_000);
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
