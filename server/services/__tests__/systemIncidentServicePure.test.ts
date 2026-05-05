/**
 * systemIncidentServicePure.test.ts — state machine + guardrail + resolution payload tests.
 */
import { expect, test } from 'vitest';
import {
  canTransition,
  computeEscalationVerdict,
  resolutionEventPayload,
} from '../systemIncidentServicePure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// canTransition
// ---------------------------------------------------------------------------

test('canTransition — open → investigating', () => expect(canTransition('open', 'investigating'), 'allowed').toBeTruthy());
test('canTransition — open → resolved', () => expect(canTransition('open', 'resolved'), 'allowed').toBeTruthy());
test('canTransition — investigating → remediating', () => expect(canTransition('investigating', 'remediating'), 'allowed').toBeTruthy());
test('canTransition — escalated → investigating', () => expect(canTransition('escalated', 'investigating'), 'allowed').toBeTruthy());
test('canTransition — resolved → open is INVALID', () => expect(!canTransition('resolved', 'open'), 'should be blocked').toBeTruthy());
test('canTransition — resolved → investigating is INVALID', () => expect(!canTransition('resolved', 'investigating'), 'should be blocked').toBeTruthy());
test('canTransition — suppressed → open (unsuppress)', () => expect(canTransition('suppressed', 'open'), 'unsuppress allowed').toBeTruthy());

// ---------------------------------------------------------------------------
// computeEscalationVerdict
// ---------------------------------------------------------------------------

const now = new Date('2025-01-15T12:00:00Z');

test('escalation verdict — no previous escalations → allowed', () => {
  const verdict = computeEscalationVerdict({ escalationCount: 0, escalatedAt: null, now });
  expect(verdict.allowed, 'should be allowed').toBeTruthy();
});

test('escalation verdict — 1 escalation after rate limit → allowed', () => {
  const escalatedAt = new Date(now.getTime() - 90_000); // 90 seconds ago
  const verdict = computeEscalationVerdict({ escalationCount: 1, escalatedAt, now });
  expect(verdict.allowed, 'after 60s rate limit window should be allowed').toBeTruthy();
});

test('escalation verdict — rate limited within window', () => {
  const escalatedAt = new Date(now.getTime() - 30_000); // 30 seconds ago
  const verdict = computeEscalationVerdict({ escalationCount: 1, escalatedAt, now });
  expect(!verdict.allowed, 'within 60s window should be blocked').toBeTruthy();
  if (!verdict.allowed) {
    expect(verdict.reason, 'reason').toBe('rate_limited');
    expect((verdict as { secondsRemaining: number }).secondsRemaining > 0, 'secondsRemaining > 0').toBeTruthy();
  }
});

test('escalation verdict — hard cap reached', () => {
  const verdict = computeEscalationVerdict({ escalationCount: 3, escalatedAt: null, now });
  expect(!verdict.allowed, 'hard cap should block').toBeTruthy();
  if (!verdict.allowed) {
    expect(verdict.reason, 'reason').toBe('hard_cap_reached');
  }
});

test('escalation verdict — custom hard cap', () => {
  const verdict = computeEscalationVerdict({ escalationCount: 2, escalatedAt: null, now, hardCap: 2 });
  expect(!verdict.allowed, 'custom cap of 2 should block at count 2').toBeTruthy();
});

// ---------------------------------------------------------------------------
// resolutionEventPayload
// ---------------------------------------------------------------------------

test('resolutionEventPayload — no escalated task → resolutionLinkedToTask is null', () => {
  const result = resolutionEventPayload({
    incidentId: 'i1',
    escalatedTaskId: null,
    escalationCount: 0,
    previousTaskIds: [],
    resolvedByUserId: 'u1',
  });
  expect(result.resolutionLinkedToTask, 'null when no task').toBe(null);
  expect(result.resolve.resolvedByUserId, 'resolve payload').toBe('u1');
});

test('resolutionEventPayload — with escalated task → resolutionLinkedToTask is set', () => {
  const result = resolutionEventPayload({
    incidentId: 'i1',
    escalatedTaskId: 't1',
    escalationCount: 1,
    previousTaskIds: [],
    resolvedByUserId: 'u1',
    resolutionNote: 'Fixed the connection',
    linkedPrUrl: 'https://github.com/example/pr/42',
  });
  expect(result.resolutionLinkedToTask !== null, 'should have linked task payload').toBeTruthy();
  expect((result.resolutionLinkedToTask as { taskId: string }).taskId, 'taskId').toBe('t1');
  expect((result.resolutionLinkedToTask as { wasSuccessful: null }).wasSuccessful, 'wasSuccessful null in Phase 0.5').toBe(null);
  expect((result.resolve as { linkedPrUrl: string }).linkedPrUrl, 'linkedPrUrl in resolve payload').toBe('https://github.com/example/pr/42');
});

// ---------------------------------------------------------------------------
