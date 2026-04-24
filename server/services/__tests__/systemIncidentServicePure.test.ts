/**
 * systemIncidentServicePure.test.ts — state machine + guardrail + resolution payload tests.
 */
import {
  canTransition,
  computeEscalationVerdict,
  resolutionEventPayload,
} from '../systemIncidentServicePure.js';

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

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// canTransition
// ---------------------------------------------------------------------------

test('canTransition — open → investigating', () => assert(canTransition('open', 'investigating'), 'allowed'));
test('canTransition — open → resolved', () => assert(canTransition('open', 'resolved'), 'allowed'));
test('canTransition — investigating → remediating', () => assert(canTransition('investigating', 'remediating'), 'allowed'));
test('canTransition — escalated → investigating', () => assert(canTransition('escalated', 'investigating'), 'allowed'));
test('canTransition — resolved → open is INVALID', () => assert(!canTransition('resolved', 'open'), 'should be blocked'));
test('canTransition — resolved → investigating is INVALID', () => assert(!canTransition('resolved', 'investigating'), 'should be blocked'));
test('canTransition — suppressed → open (unsuppress)', () => assert(canTransition('suppressed', 'open'), 'unsuppress allowed'));

// ---------------------------------------------------------------------------
// computeEscalationVerdict
// ---------------------------------------------------------------------------

const now = new Date('2025-01-15T12:00:00Z');

test('escalation verdict — no previous escalations → allowed', () => {
  const verdict = computeEscalationVerdict({ escalationCount: 0, escalatedAt: null, now });
  assert(verdict.allowed, 'should be allowed');
});

test('escalation verdict — 1 escalation after rate limit → allowed', () => {
  const escalatedAt = new Date(now.getTime() - 90_000); // 90 seconds ago
  const verdict = computeEscalationVerdict({ escalationCount: 1, escalatedAt, now });
  assert(verdict.allowed, 'after 60s rate limit window should be allowed');
});

test('escalation verdict — rate limited within window', () => {
  const escalatedAt = new Date(now.getTime() - 30_000); // 30 seconds ago
  const verdict = computeEscalationVerdict({ escalationCount: 1, escalatedAt, now });
  assert(!verdict.allowed, 'within 60s window should be blocked');
  if (!verdict.allowed) {
    assertEqual(verdict.reason, 'rate_limited', 'reason');
    assert((verdict as { secondsRemaining: number }).secondsRemaining > 0, 'secondsRemaining > 0');
  }
});

test('escalation verdict — hard cap reached', () => {
  const verdict = computeEscalationVerdict({ escalationCount: 3, escalatedAt: null, now });
  assert(!verdict.allowed, 'hard cap should block');
  if (!verdict.allowed) {
    assertEqual(verdict.reason, 'hard_cap_reached', 'reason');
  }
});

test('escalation verdict — custom hard cap', () => {
  const verdict = computeEscalationVerdict({ escalationCount: 2, escalatedAt: null, now, hardCap: 2 });
  assert(!verdict.allowed, 'custom cap of 2 should block at count 2');
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
  assertEqual(result.resolutionLinkedToTask, null, 'null when no task');
  assertEqual(result.resolve.resolvedByUserId, 'u1', 'resolve payload');
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
  assert(result.resolutionLinkedToTask !== null, 'should have linked task payload');
  assertEqual((result.resolutionLinkedToTask as { taskId: string }).taskId, 't1', 'taskId');
  assertEqual((result.resolutionLinkedToTask as { wasSuccessful: null }).wasSuccessful, null, 'wasSuccessful null in Phase 0.5');
  assertEqual((result.resolve as { linkedPrUrl: string }).linkedPrUrl, 'https://github.com/example/pr/42', 'linkedPrUrl in resolve payload');
});

// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
