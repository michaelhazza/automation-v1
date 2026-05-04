// Tests for checkAdmit — pure admit-check function.
// Run: npx tsx server/services/systemMonitor/triage/__tests__/triageAdmit.test.ts

import { expect, test } from 'vitest';
import { checkAdmit } from '../triageAdmitPure.js';

const failures: string[] = [];

// ── Kill switch ───────────────────────────────────────────────────────────────

console.log('\nkill switch');

test('admits when SYSTEM_MONITOR_ENABLED is unset', () => {
  delete process.env.SYSTEM_MONITOR_ENABLED;
  const v = checkAdmit('high', 'agent', null, 0);
  expect(v.admitted, 'expected admitted=true').toBeTruthy();
});

test('rejects when SYSTEM_MONITOR_ENABLED=false', () => {
  process.env.SYSTEM_MONITOR_ENABLED = 'false';
  const v = checkAdmit('high', 'agent', null, 0);
  expect(!v.admitted && v.reason === 'disabled', `expected disabled, got ${JSON.stringify(v)}`).toBeTruthy();
  delete process.env.SYSTEM_MONITOR_ENABLED;
});

// ── Severity gate ─────────────────────────────────────────────────────────────

console.log('\nseverity gate');

test('admits severity=medium', () => {
  const v = checkAdmit('medium', 'agent', null, 0);
  expect(v.admitted, 'medium should be admitted').toBeTruthy();
});

test('admits severity=high', () => {
  const v = checkAdmit('high', 'agent', null, 0);
  expect(v.admitted, 'high should be admitted').toBeTruthy();
});

test('admits severity=critical', () => {
  const v = checkAdmit('critical', 'agent', null, 0);
  expect(v.admitted, 'critical should be admitted').toBeTruthy();
});

test('rejects severity=low', () => {
  const v = checkAdmit('low', 'agent', null, 0);
  expect(!v.admitted && v.reason === 'severity_too_low', `expected severity_too_low, got ${JSON.stringify(v)}`).toBeTruthy();
});

// ── Self-check gate ───────────────────────────────────────────────────────────

console.log('\nself-check gate');

test('rejects source=self', () => {
  const v = checkAdmit('high', 'self', null, 0);
  expect(!v.admitted && v.reason === 'self_check', `expected self_check, got ${JSON.stringify(v)}`).toBeTruthy();
});

test('rejects isSelfCheck=true in metadata', () => {
  const v = checkAdmit('high', 'synthetic', { isSelfCheck: true }, 0);
  expect(!v.admitted && v.reason === 'self_check', `expected self_check, got ${JSON.stringify(v)}`).toBeTruthy();
});

test('rejects isMonitorSelfStuck=true in metadata', () => {
  const v = checkAdmit('high', 'synthetic', { isMonitorSelfStuck: true }, 0);
  expect(!v.admitted && v.reason === 'self_check', `expected self_check, got ${JSON.stringify(v)}`).toBeTruthy();
});

test('admits synthetic source without self-check metadata', () => {
  const v = checkAdmit('high', 'synthetic', { someOtherKey: true }, 0);
  expect(v.admitted, 'synthetic without isSelfCheck should be admitted').toBeTruthy();
});

// ── Rate-limit gate ───────────────────────────────────────────────────────────

console.log('\nrate-limit gate');

test('admits at triageAttemptCount=4 (below cap=5)', () => {
  const v = checkAdmit('high', 'agent', null, 4);
  expect(v.admitted, 'should be admitted at count=4').toBeTruthy();
});

test('rejects at triageAttemptCount=5 (at cap)', () => {
  const v = checkAdmit('high', 'agent', null, 5);
  expect(!v.admitted && v.reason === 'rate_limited', `expected rate_limited, got ${JSON.stringify(v)}`).toBeTruthy();
});

test('rejects at triageAttemptCount=10 (above cap)', () => {
  const v = checkAdmit('high', 'agent', null, 10);
  expect(!v.admitted && v.reason === 'rate_limited', `expected rate_limited, got ${JSON.stringify(v)}`).toBeTruthy();
});

// ── Priority: disabled > severity > self_check > rate_limit ──────────────────

console.log('\npriority order');

test('disabled beats severity_too_low', () => {
  process.env.SYSTEM_MONITOR_ENABLED = 'false';
  const v = checkAdmit('low', 'agent', null, 0);
  expect(!v.admitted && v.reason === 'disabled', `expected disabled, got ${JSON.stringify(v)}`).toBeTruthy();
  delete process.env.SYSTEM_MONITOR_ENABLED;
});

// ── Report ────────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.log('\nFailed:');
  failures.forEach((f) => console.log(f));
}
