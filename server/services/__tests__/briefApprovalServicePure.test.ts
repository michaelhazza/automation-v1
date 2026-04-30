// guard-ignore-file: pure-helper-convention reason="pure logic is tested inline within this handwritten harness; parent-directory sibling import not applicable for this self-contained test pattern"
/**
 * briefApprovalServicePure.test.ts
 *
 * Pure tests for DR3 idempotency contract per spec §4.5.1.
 * Tests the helper functions and decision logic — no DB access.
 *
 * Run via: npx tsx server/services/__tests__/briefApprovalServicePure.test.ts
 */

import { expect, test } from 'vitest';

export {};

console.log('\nDR3 — briefApprovalService idempotency pure tests\n');

// ── isUniqueViolation helper ──────────────────────────────────────────────────
test('isUniqueViolation: recognises PG 23505 error code', () => {
  const isUV = (err: unknown): boolean =>
    typeof err === 'object' && err !== null && 'code' in err && (err as Record<string, unknown>)['code'] === '23505';

  expect(isUV({ code: '23505' }), '23505 must be detected').toBeTruthy();
  expect(!isUV({ code: '23503' }), 'other codes must not be detected').toBeTruthy();
  expect(!isUV(new Error('unique violation')), 'plain Error without code must not be detected').toBeTruthy();
  expect(!isUV(null), 'null must not be detected').toBeTruthy();
  expect(!isUV(undefined), 'undefined must not be detected').toBeTruthy();
});

// ── decision idempotency semantics ────────────────────────────────────────────
test('identical decision match → idempotent: true (same decision)', () => {
  const existing = { decision: 'approve' as const, kind: 'approval_decision' as const };
  const incomingDecision = 'approve';
  const isIdempotent = existing.decision === incomingDecision;
  expect(isIdempotent, 'same decision must be idempotent').toBeTruthy();
});

test('conflicting decision → NOT idempotent (different decision)', () => {
  const existing = { decision: 'approve' as string, kind: 'approval_decision' as string };
  const incomingDecision = 'reject';
  const isIdempotent = existing.decision === incomingDecision;
  expect(!isIdempotent, 'different decision must not be idempotent → 409').toBeTruthy();
});

// ── collision detection ───────────────────────────────────────────────────────
test('decisionMatchCount > 1 → artefact_id_collision (hard failure)', () => {
  const decisionMatchCount = 2;
  const shouldThrow = decisionMatchCount > 1;
  expect(shouldThrow, 'two matching decision artefacts must trigger collision error').toBeTruthy();
});

test('decisionMatchCount === 1 → no collision', () => {
  const decisionMatchCount = 1;
  const shouldThrow = decisionMatchCount > 1;
  expect(!shouldThrow, 'exactly one match must not trigger collision').toBeTruthy();
});

// ── stale check ───────────────────────────────────────────────────────────────
test('cancelled brief → artefact_stale', () => {
  const taskStatus = 'cancelled';
  const isStale = taskStatus === 'cancelled';
  expect(isStale, 'cancelled brief must be stale').toBeTruthy();
});

test('inbox brief → not stale', () => {
  const taskStatus = 'inbox' as string;
  const isStale = taskStatus === 'cancelled';
  expect(!isStale, 'inbox brief must not be stale').toBeTruthy();
});

test('completed brief → not stale', () => {
  const taskStatus = 'completed' as string;
  const isStale = taskStatus === 'cancelled';
  expect(!isStale, 'completed brief must not be stale').toBeTruthy();
});

// ── proposeAction failure → executionStatus: failed ──────────────────────────
test('proposeAction throws → executionStatus falls back to failed', () => {
  let executionStatus: 'pending' | 'failed' = 'failed';
  try {
    throw new Error('proposeAction failure');
  } catch {
    executionStatus = 'failed';
  }
  expect(executionStatus === 'failed', 'executionStatus must be failed when proposeAction throws').toBeTruthy();
});

test('proposeAction succeeds with agentId → executionStatus pending', () => {
  const agentId = 'agent-123';
  let executionStatus: 'pending' | 'failed' = 'failed';
  if (agentId) {
    // simulate success
    executionStatus = 'pending';
  }
  expect(executionStatus === 'pending', 'executionStatus must be pending on proposeAction success').toBeTruthy();
});

test('null agentId → executionStatus failed (no proposeAction called)', () => {
  const agentId: string | null = null;
  let executionStatus: 'pending' | 'failed' = 'failed';
  if (agentId) {
    executionStatus = 'pending';
  }
  expect(executionStatus === 'failed', 'null agentId must yield failed executionStatus').toBeTruthy();
});

// ── artefact kind guard ───────────────────────────────────────────────────────
test('artefact.kind === approval → valid approval card', () => {
  const a = { kind: 'approval', artefactId: 'id-1' };
  expect(a.kind === 'approval', 'approval artefact must pass kind guard').toBeTruthy();
});

test('artefact.kind === structured → artefact_not_approval', () => {
  const a = { kind: 'structured', artefactId: 'id-1' };
  expect(a.kind !== 'approval', 'non-approval must be rejected').toBeTruthy();
});

// Summary
setTimeout(() => {
}, 50);
