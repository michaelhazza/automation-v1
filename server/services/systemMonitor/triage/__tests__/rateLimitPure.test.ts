// Tests for shouldAutoEscalate — pure auto-escalation decision function.
// Run: npx tsx server/services/systemMonitor/triage/__tests__/rateLimitPure.test.ts

import { shouldAutoEscalate, type AutoEscalateDecision } from '../autoEscalate.js';

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

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const now = new Date('2025-01-01T12:00:00Z');

function makeIncident(overrides: {
  severity?: 'low' | 'medium' | 'high' | 'critical';
  status?: 'open' | 'investigating' | 'remediating' | 'escalated' | 'resolved' | 'suppressed';
  escalationCount?: number | null;
  escalatedAt?: Date | null;
}) {
  return {
    severity: (overrides.severity ?? 'high') as 'low' | 'medium' | 'high' | 'critical',
    status: (overrides.status ?? 'open') as 'open' | 'investigating' | 'remediating' | 'escalated' | 'resolved' | 'suppressed',
    escalationCount: overrides.escalationCount ?? 0,
    escalatedAt: overrides.escalatedAt ?? null,
  };
}

// ── Severity gate ──────────────────────────────────────────────────────────────

console.log('\n--- Severity gate ---');

test('low severity → no auto-escalate', () => {
  const d = shouldAutoEscalate(makeIncident({ severity: 'low' }), now);
  assert(!d.yes, 'should not escalate');
  assertEqual(d.reason, 'severity_too_low', 'reason');
});

test('medium severity → no auto-escalate', () => {
  const d = shouldAutoEscalate(makeIncident({ severity: 'medium' }), now);
  assert(!d.yes, 'should not escalate');
  assertEqual(d.reason, 'severity_too_low', 'reason');
});

test('high severity → eligible', () => {
  const d = shouldAutoEscalate(makeIncident({ severity: 'high' }), now);
  assert(d.yes, 'should escalate for high severity when guardrails allow');
});

test('critical severity → eligible', () => {
  const d = shouldAutoEscalate(makeIncident({ severity: 'critical' }), now);
  assert(d.yes, 'should escalate for critical severity');
});

// ── Status gate ────────────────────────────────────────────────────────────────

console.log('\n--- Status gate ---');

test('resolved incident → no auto-escalate', () => {
  const d = shouldAutoEscalate(makeIncident({ status: 'resolved' }), now);
  assert(!d.yes, 'should not escalate resolved');
  assertEqual(d.reason, 'incident_terminal', 'reason');
});

test('suppressed incident → no auto-escalate', () => {
  const d = shouldAutoEscalate(makeIncident({ status: 'suppressed' }), now);
  assert(!d.yes, 'should not escalate suppressed');
  assertEqual(d.reason, 'incident_terminal', 'reason');
});

test('open incident → eligible', () => {
  const d = shouldAutoEscalate(makeIncident({ status: 'open' }), now);
  assert(d.yes, 'open incident eligible');
});

test('investigating incident → eligible', () => {
  const d = shouldAutoEscalate(makeIncident({ status: 'investigating' }), now);
  assert(d.yes, 'investigating incident eligible');
});

test('escalated incident → eligible (can re-escalate if guardrail allows)', () => {
  const d = shouldAutoEscalate(makeIncident({ status: 'escalated', escalationCount: 1 }), now);
  assert(d.yes, 'escalated-but-not-capped incident eligible');
});

// ── Guardrail gate ────────────────────────────────────────────────────────────

console.log('\n--- Guardrail gate ---');

test('escalation hard cap reached (count=3) → no auto-escalate', () => {
  const d = shouldAutoEscalate(makeIncident({ escalationCount: 3 }), now);
  assert(!d.yes, 'hard cap blocks auto-escalate');
  assertEqual(d.reason, 'guardrail_cap', 'reason is guardrail_cap');
});

test('escalation count at 2 (default cap=3) → eligible', () => {
  const d = shouldAutoEscalate(makeIncident({ escalationCount: 2 }), now);
  assert(d.yes, 'count below cap → eligible');
});

test('rate-limited cooldown (escalated 30s ago) → no auto-escalate', () => {
  const recentEscalation = new Date(now.getTime() - 30 * 1000); // 30 seconds ago
  const d = shouldAutoEscalate(makeIncident({ escalationCount: 1, escalatedAt: recentEscalation }), now);
  assert(!d.yes, 'cooldown blocks auto-escalate');
  assertEqual(d.reason, 'cooldown', 'reason is cooldown');
});

test('cooldown expired (escalated 2min ago) → eligible', () => {
  const oldEscalation = new Date(now.getTime() - 2 * 60 * 1000); // 2 min ago (default 60s cooldown)
  const d = shouldAutoEscalate(makeIncident({ escalationCount: 1, escalatedAt: oldEscalation }), now);
  assert(d.yes, 'expired cooldown → eligible');
});

// ── Priority (severity checked before status) ─────────────────────────────────

console.log('\n--- Priority order ---');

test('low severity + resolved → severity_too_low (first gate)', () => {
  const d = shouldAutoEscalate(makeIncident({ severity: 'low', status: 'resolved' }), now);
  assertEqual(d.reason, 'severity_too_low', 'severity checked first');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
if (failures.length > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
}
console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
