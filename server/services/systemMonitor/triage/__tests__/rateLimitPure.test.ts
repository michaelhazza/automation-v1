// Tests for shouldAutoEscalate — pure auto-escalation decision function.
// Run: npx tsx server/services/systemMonitor/triage/__tests__/rateLimitPure.test.ts

import { expect, test } from 'vitest';
import { shouldAutoEscalate, type AutoEscalateDecision } from '../autoEscalate.js';

const failures: string[] = [];

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
  expect(!d.yes, 'should not escalate').toBeTruthy();
  expect(d.reason, 'reason').toBe('severity_too_low');
});

test('medium severity → no auto-escalate', () => {
  const d = shouldAutoEscalate(makeIncident({ severity: 'medium' }), now);
  expect(!d.yes, 'should not escalate').toBeTruthy();
  expect(d.reason, 'reason').toBe('severity_too_low');
});

test('high severity → eligible', () => {
  const d = shouldAutoEscalate(makeIncident({ severity: 'high' }), now);
  expect(d.yes, 'should escalate for high severity when guardrails allow').toBeTruthy();
});

test('critical severity → eligible', () => {
  const d = shouldAutoEscalate(makeIncident({ severity: 'critical' }), now);
  expect(d.yes, 'should escalate for critical severity').toBeTruthy();
});

// ── Status gate ────────────────────────────────────────────────────────────────

console.log('\n--- Status gate ---');

test('resolved incident → no auto-escalate', () => {
  const d = shouldAutoEscalate(makeIncident({ status: 'resolved' }), now);
  expect(!d.yes, 'should not escalate resolved').toBeTruthy();
  expect(d.reason, 'reason').toBe('incident_terminal');
});

test('suppressed incident → no auto-escalate', () => {
  const d = shouldAutoEscalate(makeIncident({ status: 'suppressed' }), now);
  expect(!d.yes, 'should not escalate suppressed').toBeTruthy();
  expect(d.reason, 'reason').toBe('incident_terminal');
});

test('open incident → eligible', () => {
  const d = shouldAutoEscalate(makeIncident({ status: 'open' }), now);
  expect(d.yes, 'open incident eligible').toBeTruthy();
});

test('investigating incident → eligible', () => {
  const d = shouldAutoEscalate(makeIncident({ status: 'investigating' }), now);
  expect(d.yes, 'investigating incident eligible').toBeTruthy();
});

test('escalated incident → eligible (can re-escalate if guardrail allows)', () => {
  const d = shouldAutoEscalate(makeIncident({ status: 'escalated', escalationCount: 1 }), now);
  expect(d.yes, 'escalated-but-not-capped incident eligible').toBeTruthy();
});

// ── Guardrail gate ────────────────────────────────────────────────────────────

console.log('\n--- Guardrail gate ---');

test('escalation hard cap reached (count=3) → no auto-escalate', () => {
  const d = shouldAutoEscalate(makeIncident({ escalationCount: 3 }), now);
  expect(!d.yes, 'hard cap blocks auto-escalate').toBeTruthy();
  expect(d.reason, 'reason is guardrail_cap').toBe('guardrail_cap');
});

test('escalation count at 2 (default cap=3) → eligible', () => {
  const d = shouldAutoEscalate(makeIncident({ escalationCount: 2 }), now);
  expect(d.yes, 'count below cap → eligible').toBeTruthy();
});

test('rate-limited cooldown (escalated 30s ago) → no auto-escalate', () => {
  const recentEscalation = new Date(now.getTime() - 30 * 1000); // 30 seconds ago
  const d = shouldAutoEscalate(makeIncident({ escalationCount: 1, escalatedAt: recentEscalation }), now);
  expect(!d.yes, 'cooldown blocks auto-escalate').toBeTruthy();
  expect(d.reason, 'reason is cooldown').toBe('cooldown');
});

test('cooldown expired (escalated 2min ago) → eligible', () => {
  const oldEscalation = new Date(now.getTime() - 2 * 60 * 1000); // 2 min ago (default 60s cooldown)
  const d = shouldAutoEscalate(makeIncident({ escalationCount: 1, escalatedAt: oldEscalation }), now);
  expect(d.yes, 'expired cooldown → eligible').toBeTruthy();
});

// ── Priority (severity checked before status) ─────────────────────────────────

console.log('\n--- Priority order ---');

test('low severity + resolved → severity_too_low (first gate)', () => {
  const d = shouldAutoEscalate(makeIncident({ severity: 'low', status: 'resolved' }), now);
  expect(d.reason, 'severity checked first').toBe('severity_too_low');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
if (failures.length > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
}
