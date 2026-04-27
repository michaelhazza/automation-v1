/**
 * incidentSilencePure — unit tests for isMonitoringSilent and env parsers.
 *
 * Runnable via:
 *   npx tsx server/services/systemMonitor/synthetic/__tests__/incidentSilencePure.test.ts
 */
import {
  isMonitoringSilent,
  parseSilenceHoursEnv,
  parseProofOfLifeHoursEnv,
} from '../incidentSilencePure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
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

function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

test('(0, 0) → false (cold-start: no proof-of-life)', () => {
  check(!isMonitoringSilent(0, 0), 'expected false: no proof-of-life (syntheticFires=0)');
});

test('(0, 1) → true (silent + has proof-of-life)', () => {
  check(isMonitoringSilent(0, 1), 'expected true: no incidents + 1 synthetic fire');
});

test('(0, 5) → true (silent + multiple synthetic fires)', () => {
  check(isMonitoringSilent(0, 5), 'expected true: no incidents + 5 synthetic fires');
});

test('(1, 0) → false (has incident, no proof-of-life)', () => {
  check(!isMonitoringSilent(1, 0), 'expected false: incident in window, not silent');
});

test('(1, 5) → false (has incident despite synthetic fires)', () => {
  check(!isMonitoringSilent(1, 5), 'expected false: incident in window = not silent');
});

// Env-parser hardening (mirrors parseStaleAfterMinutesEnv guards).

test('parseSilenceHoursEnv: undefined → default 12', () => {
  check(parseSilenceHoursEnv(undefined) === 12, 'expected 12 for undefined');
});

test('parseSilenceHoursEnv: empty string → default 12', () => {
  check(parseSilenceHoursEnv('') === 12, 'expected 12 for empty string');
});

test('parseSilenceHoursEnv: non-numeric → default 12', () => {
  check(parseSilenceHoursEnv('abc') === 12, 'expected 12 for non-numeric');
});

test('parseSilenceHoursEnv: zero → default 12 (non-positive)', () => {
  check(parseSilenceHoursEnv('0') === 12, 'expected 12 for zero');
});

test('parseSilenceHoursEnv: valid 6 → 6', () => {
  check(parseSilenceHoursEnv('6') === 6, 'expected 6 for valid string "6"');
});

test('parseProofOfLifeHoursEnv: undefined → default 24', () => {
  check(parseProofOfLifeHoursEnv(undefined) === 24, 'expected 24 for undefined');
});

test('parseProofOfLifeHoursEnv: non-numeric → default 24', () => {
  check(parseProofOfLifeHoursEnv('abc') === 24, 'expected 24 for non-numeric');
});

test('parseProofOfLifeHoursEnv: zero → default 24 (non-positive)', () => {
  check(parseProofOfLifeHoursEnv('0') === 24, 'expected 24 for zero');
});

test('parseProofOfLifeHoursEnv: valid 48 → 48', () => {
  check(parseProofOfLifeHoursEnv('48') === 48, 'expected 48 for valid string "48"');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
