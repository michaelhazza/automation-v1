// Tests for checkAdmit — pure admit-check function.
// Run: npx tsx server/services/systemMonitor/triage/__tests__/triageAdmit.test.ts

import { checkAdmit } from '../triageAdmitPure.js';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`  ✗ ${name}: ${msg}`);
    console.log(`  ✗ ${name}: ${msg}`);
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ── Kill switch ───────────────────────────────────────────────────────────────

console.log('\nkill switch');

test('admits when SYSTEM_MONITOR_ENABLED is unset', () => {
  delete process.env.SYSTEM_MONITOR_ENABLED;
  const v = checkAdmit('high', 'agent', null, 0);
  assert(v.admitted, 'expected admitted=true');
});

test('rejects when SYSTEM_MONITOR_ENABLED=false', () => {
  process.env.SYSTEM_MONITOR_ENABLED = 'false';
  const v = checkAdmit('high', 'agent', null, 0);
  assert(!v.admitted && v.reason === 'disabled', `expected disabled, got ${JSON.stringify(v)}`);
  delete process.env.SYSTEM_MONITOR_ENABLED;
});

// ── Severity gate ─────────────────────────────────────────────────────────────

console.log('\nseverity gate');

test('admits severity=medium', () => {
  const v = checkAdmit('medium', 'agent', null, 0);
  assert(v.admitted, 'medium should be admitted');
});

test('admits severity=high', () => {
  const v = checkAdmit('high', 'agent', null, 0);
  assert(v.admitted, 'high should be admitted');
});

test('admits severity=critical', () => {
  const v = checkAdmit('critical', 'agent', null, 0);
  assert(v.admitted, 'critical should be admitted');
});

test('rejects severity=low', () => {
  const v = checkAdmit('low', 'agent', null, 0);
  assert(!v.admitted && v.reason === 'severity_too_low', `expected severity_too_low, got ${JSON.stringify(v)}`);
});

// ── Self-check gate ───────────────────────────────────────────────────────────

console.log('\nself-check gate');

test('rejects source=self', () => {
  const v = checkAdmit('high', 'self', null, 0);
  assert(!v.admitted && v.reason === 'self_check', `expected self_check, got ${JSON.stringify(v)}`);
});

test('rejects isSelfCheck=true in metadata', () => {
  const v = checkAdmit('high', 'synthetic', { isSelfCheck: true }, 0);
  assert(!v.admitted && v.reason === 'self_check', `expected self_check, got ${JSON.stringify(v)}`);
});

test('rejects isMonitorSelfStuck=true in metadata', () => {
  const v = checkAdmit('high', 'synthetic', { isMonitorSelfStuck: true }, 0);
  assert(!v.admitted && v.reason === 'self_check', `expected self_check, got ${JSON.stringify(v)}`);
});

test('admits synthetic source without self-check metadata', () => {
  const v = checkAdmit('high', 'synthetic', { someOtherKey: true }, 0);
  assert(v.admitted, 'synthetic without isSelfCheck should be admitted');
});

// ── Rate-limit gate ───────────────────────────────────────────────────────────

console.log('\nrate-limit gate');

test('admits at triageAttemptCount=4 (below cap=5)', () => {
  const v = checkAdmit('high', 'agent', null, 4);
  assert(v.admitted, 'should be admitted at count=4');
});

test('rejects at triageAttemptCount=5 (at cap)', () => {
  const v = checkAdmit('high', 'agent', null, 5);
  assert(!v.admitted && v.reason === 'rate_limited', `expected rate_limited, got ${JSON.stringify(v)}`);
});

test('rejects at triageAttemptCount=10 (above cap)', () => {
  const v = checkAdmit('high', 'agent', null, 10);
  assert(!v.admitted && v.reason === 'rate_limited', `expected rate_limited, got ${JSON.stringify(v)}`);
});

// ── Priority: disabled > severity > self_check > rate_limit ──────────────────

console.log('\npriority order');

test('disabled beats severity_too_low', () => {
  process.env.SYSTEM_MONITOR_ENABLED = 'false';
  const v = checkAdmit('low', 'agent', null, 0);
  assert(!v.admitted && v.reason === 'disabled', `expected disabled, got ${JSON.stringify(v)}`);
  delete process.env.SYSTEM_MONITOR_ENABLED;
});

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailed:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
