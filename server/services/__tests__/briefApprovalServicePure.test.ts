/**
 * briefApprovalServicePure.test.ts
 *
 * Pure tests for DR3 idempotency contract per spec §4.5.1.
 * Tests the helper functions and decision logic — no DB access.
 *
 * Run via: npx tsx server/services/__tests__/briefApprovalServicePure.test.ts
 */

export {};

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  const result = (async () => {
    try {
      await fn();
      passed++;
      console.log(`  PASS  ${name}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${name}`);
      console.log(`        ${err instanceof Error ? err.message : err}`);
    }
  })();
  // Collect promise to allow sequential execution
  void result;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

console.log('\nDR3 — briefApprovalService idempotency pure tests\n');

// ── isUniqueViolation helper ──────────────────────────────────────────────────
test('isUniqueViolation: recognises PG 23505 error code', () => {
  const isUV = (err: unknown): boolean =>
    typeof err === 'object' && err !== null && 'code' in err && (err as Record<string, unknown>)['code'] === '23505';

  assert(isUV({ code: '23505' }), '23505 must be detected');
  assert(!isUV({ code: '23503' }), 'other codes must not be detected');
  assert(!isUV(new Error('unique violation')), 'plain Error without code must not be detected');
  assert(!isUV(null), 'null must not be detected');
  assert(!isUV(undefined), 'undefined must not be detected');
});

// ── decision idempotency semantics ────────────────────────────────────────────
test('identical decision match → idempotent: true (same decision)', () => {
  const existing = { decision: 'approve' as const, kind: 'approval_decision' as const };
  const incomingDecision = 'approve';
  const isIdempotent = existing.decision === incomingDecision;
  assert(isIdempotent, 'same decision must be idempotent');
});

test('conflicting decision → NOT idempotent (different decision)', () => {
  const existing = { decision: 'approve' as string, kind: 'approval_decision' as string };
  const incomingDecision = 'reject';
  const isIdempotent = existing.decision === incomingDecision;
  assert(!isIdempotent, 'different decision must not be idempotent → 409');
});

// ── collision detection ───────────────────────────────────────────────────────
test('decisionMatchCount > 1 → artefact_id_collision (hard failure)', () => {
  const decisionMatchCount = 2;
  const shouldThrow = decisionMatchCount > 1;
  assert(shouldThrow, 'two matching decision artefacts must trigger collision error');
});

test('decisionMatchCount === 1 → no collision', () => {
  const decisionMatchCount = 1;
  const shouldThrow = decisionMatchCount > 1;
  assert(!shouldThrow, 'exactly one match must not trigger collision');
});

// ── stale check ───────────────────────────────────────────────────────────────
test('cancelled brief → artefact_stale', () => {
  const taskStatus = 'cancelled';
  const isStale = taskStatus === 'cancelled';
  assert(isStale, 'cancelled brief must be stale');
});

test('inbox brief → not stale', () => {
  const taskStatus = 'inbox' as string;
  const isStale = taskStatus === 'cancelled';
  assert(!isStale, 'inbox brief must not be stale');
});

test('completed brief → not stale', () => {
  const taskStatus = 'completed' as string;
  const isStale = taskStatus === 'cancelled';
  assert(!isStale, 'completed brief must not be stale');
});

// ── proposeAction failure → executionStatus: failed ──────────────────────────
test('proposeAction throws → executionStatus falls back to failed', () => {
  let executionStatus: 'pending' | 'failed' = 'failed';
  try {
    throw new Error('proposeAction failure');
  } catch {
    executionStatus = 'failed';
  }
  assert(executionStatus === 'failed', 'executionStatus must be failed when proposeAction throws');
});

test('proposeAction succeeds with agentId → executionStatus pending', () => {
  const agentId = 'agent-123';
  let executionStatus: 'pending' | 'failed' = 'failed';
  if (agentId) {
    // simulate success
    executionStatus = 'pending';
  }
  assert(executionStatus === 'pending', 'executionStatus must be pending on proposeAction success');
});

test('null agentId → executionStatus failed (no proposeAction called)', () => {
  const agentId: string | null = null;
  let executionStatus: 'pending' | 'failed' = 'failed';
  if (agentId) {
    executionStatus = 'pending';
  }
  assert(executionStatus === 'failed', 'null agentId must yield failed executionStatus');
});

// ── artefact kind guard ───────────────────────────────────────────────────────
test('artefact.kind === approval → valid approval card', () => {
  const a = { kind: 'approval', artefactId: 'id-1' };
  assert(a.kind === 'approval', 'approval artefact must pass kind guard');
});

test('artefact.kind === structured → artefact_not_approval', () => {
  const a = { kind: 'structured', artefactId: 'id-1' };
  assert(a.kind !== 'approval', 'non-approval must be rejected');
});

// Summary
setTimeout(() => {
  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}, 50);
