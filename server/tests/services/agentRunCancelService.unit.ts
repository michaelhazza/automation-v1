/**
 * agentRunCancelService — pure decision-logic tests.
 *
 * The cancel service's behaviour is driven by three pure decisions:
 *   1. Idempotency guard  — already terminal or 'cancelling' → no-op.
 *   2. IEE vs non-IEE    — non-null ieeRunId triggers the IEE cancel path;
 *                          null ieeRunId relies on the in-process loop tick.
 *   3. Cross-org scoping — DB query is scoped to organisationId; not found → 404.
 *
 * These tests replicate the decision logic without a real DB connection so
 * they run in any environment (CI, local sandboxes, offline).
 *
 * Run via: npx tsx server/tests/services/agentRunCancelService.unit.ts
 */

import { isTerminalRunStatus, AGENT_RUN_STATUS, IN_FLIGHT_RUN_STATUSES } from '../../../shared/runStatus.js';

export {}; // make this a module

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

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

// ── Replicated decision helper (mirrors agentRunCancelService internals) ──────
// The cancel service guards the transition with:
//   isTerminalRunStatus(status) || status === 'cancelling'  → no-op
// We test this guard directly against the shared status enum rather than
// importing the service (which would require a live DB connection).

function shouldNoOp(status: string): boolean {
  return isTerminalRunStatus(status) || status === 'cancelling';
}

function selectPath(ieeRunId: string | null): 'iee' | 'non-iee' {
  return ieeRunId !== null ? 'iee' : 'non-iee';
}

// ── §1: Idempotency guard ─────────────────────────────────────────────────────

console.log('\n── Idempotency guard ──');

test('completed → no-op (terminal)', () => {
  assert(shouldNoOp(AGENT_RUN_STATUS.COMPLETED), 'completed must be no-op');
});

test('failed → no-op (terminal)', () => {
  assert(shouldNoOp(AGENT_RUN_STATUS.FAILED), 'failed must be no-op');
});

test('cancelled → no-op (terminal)', () => {
  assert(shouldNoOp(AGENT_RUN_STATUS.CANCELLED), 'cancelled must be no-op');
});

test('timeout → no-op (terminal)', () => {
  assert(shouldNoOp(AGENT_RUN_STATUS.TIMEOUT), 'timeout must be no-op');
});

test('budget_exceeded → no-op (terminal)', () => {
  assert(shouldNoOp(AGENT_RUN_STATUS.BUDGET_EXCEEDED), 'budget_exceeded must be no-op');
});

test('loop_detected → no-op (terminal)', () => {
  assert(shouldNoOp(AGENT_RUN_STATUS.LOOP_DETECTED), 'loop_detected must be no-op');
});

test('cancelling → no-op (already in progress, prevents double-transition)', () => {
  assert(shouldNoOp(AGENT_RUN_STATUS.CANCELLING), 'cancelling must be no-op to prevent re-entry');
});

// ── §2: Cancel-eligible statuses ─────────────────────────────────────────────

console.log('\n── Cancel-eligible (in-flight) statuses ──');

test('pending → should proceed (in-flight)', () => {
  assert(!shouldNoOp(AGENT_RUN_STATUS.PENDING), 'pending must not be a no-op');
});

test('running → should proceed (in-flight)', () => {
  assert(!shouldNoOp(AGENT_RUN_STATUS.RUNNING), 'running must not be a no-op');
});

test('delegated → should proceed (in-flight)', () => {
  assert(!shouldNoOp(AGENT_RUN_STATUS.DELEGATED), 'delegated must not be a no-op');
});

test('all IN_FLIGHT_RUN_STATUSES except cancelling are cancel-eligible', () => {
  for (const status of IN_FLIGHT_RUN_STATUSES) {
    if (status === 'cancelling') continue;
    assert(!shouldNoOp(status), `${status} should be cancel-eligible`);
  }
});

// ── §3: IEE vs non-IEE path selection ────────────────────────────────────────

console.log('\n── IEE vs non-IEE path selection ──');

test('non-null ieeRunId → IEE path (cancel via iee_runs)', () => {
  assertEqual(selectPath('iee-run-abc-123'), 'iee', 'ieeRunId present → iee path');
});

test('null ieeRunId → non-IEE path (in-process loop reads agent_runs.status)', () => {
  assertEqual(selectPath(null), 'non-iee', 'ieeRunId null → non-iee path');
});

// ── §4: Cross-org scoping (DB query filters by organisationId) ────────────────

console.log('\n── Cross-org scoping ──');

// The service queries: WHERE id = $runId AND organisationId = $orgId
// If the row is absent from that query → 404.
// We simulate this by verifying the query predicate logic.

function findRunInOrg(
  runs: Array<{ id: string; organisationId: string }>,
  runId: string,
  orgId: string,
) {
  return runs.find((r) => r.id === runId && r.organisationId === orgId) ?? null;
}

test('run in same org → found (200 path)', () => {
  const runs = [{ id: 'run-1', organisationId: 'org-a' }];
  const found = findRunInOrg(runs, 'run-1', 'org-a');
  assert(found !== null, 'run in same org must be found');
});

test('run in different org → not found (404 path)', () => {
  const runs = [{ id: 'run-1', organisationId: 'org-a' }];
  const found = findRunInOrg(runs, 'run-1', 'org-b');
  assert(found === null, 'run in different org must return null → 404');
});

test('run id does not exist → not found (404 path)', () => {
  const runs = [{ id: 'run-1', organisationId: 'org-a' }];
  const found = findRunInOrg(runs, 'run-99', 'org-a');
  assert(found === null, 'unknown run id must return null → 404');
});

// ── §5: Concurrent-cancel race (the UPDATE … WHERE status IN (…) guard) ───────

console.log('\n── Concurrent cancel race ──');

// The service UPDATEs only when status IN ('pending','running','delegated').
// If a concurrent finaliser transitions the row between the SELECT and UPDATE,
// the update affects 0 rows and the service re-reads current status.

const CANCELLABLE_STATUSES = ['pending', 'running', 'delegated'] as const;

test('cancellable status set matches in-flight non-cancelling statuses', () => {
  for (const s of CANCELLABLE_STATUSES) {
    assert(
      IN_FLIGHT_RUN_STATUSES.includes(s as any),
      `${s} must be in IN_FLIGHT_RUN_STATUSES`,
    );
    assert(s !== 'cancelling', `${s} must not be 'cancelling'`);
  }
});

test('terminal status is NOT in the cancellable set (race safety)', () => {
  for (const terminal of ['completed', 'failed', 'cancelled', 'timeout'] as const) {
    assert(
      !CANCELLABLE_STATUSES.includes(terminal as any),
      `${terminal} must not be cancellable (terminal finaliser may have run)`,
    );
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
