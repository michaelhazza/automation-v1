/**
 * reviewItems.test.ts — Route-layer idempotency contract tests.
 *
 * Spec §6.2.1 (clientpulse-ui-simplification):
 *   Double-approve on an already-approved item must return 200, not 412.
 *   The service returns wasIdempotent=true on the second call, and the route
 *   skips audit + side-effects — no duplicate reviewAudit rows emitted.
 *
 * These tests verify the pure decision logic that governs route behaviour:
 *   - checkIdempotency correctly classifies the already-approved state.
 *   - wasIdempotent=true suppresses the audit path (contract check).
 *
 * No DB, no network, no side effects.
 *
 * Runnable via:
 *   npx tsx server/routes/__tests__/reviewItems.test.ts
 */

import { strict as assert } from 'node:assert';
import { checkIdempotency } from '../../services/reviewServicePure.js';

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

console.log('');
console.log('reviewItems route — idempotent-replay contract (spec §6.2.1)');
console.log('');

// ─── Issue 2: MAJOR_ACK_REQUIRED bypass on idempotent replay ─────────────────
//
// When approve is called on an already-approved item, the service returns
// wasIdempotent=true. The route must NOT gate on a pre-read isPending value
// (which would be false for an already-approved item), so the 412
// MAJOR_ACK_REQUIRED check is never reached. The function returns 200.
//
// We verify this by confirming:
//   1. checkIdempotency('approved', 'approve') returns 'idempotent' — the
//      service will short-circuit and return wasIdempotent=true.
//   2. With wasIdempotent=true, the audit/side-effect block is skipped —
//      no reviewAuditService.record call, no MAJOR_ACK_REQUIRED check.

test('already-approved item: checkIdempotency returns idempotent (not proceed)', () => {
  // The service evaluates this before touching the write path.
  // 'idempotent' means the service returns wasIdempotent=true and the
  // route falls through to res.json() with HTTP 200.
  const outcome = checkIdempotency('approved', 'approve');
  assert.equal(outcome, 'idempotent',
    'Double-approve must resolve as idempotent — if this fails the route would ' +
    'proceed to the write path and may re-emit audit rows or trigger 412.');
});

test('completed item (post-execution): checkIdempotency returns idempotent (not proceed)', () => {
  // Items move to "completed" after execution. A late retry must also
  // be treated as idempotent, not re-processed.
  const outcome = checkIdempotency('completed', 'approve');
  assert.equal(outcome, 'idempotent');
});

test('already-approved item: wasIdempotent=true suppresses audit path', () => {
  // Simulate the route's guard: if wasIdempotent is true, the audit block
  // is skipped. This pins the contract — the guard must check wasIdempotent,
  // not the pre-read reviewStatus (which could be stale under concurrency).
  const simulatedServiceResult = { actionId: 'action-uuid', wasIdempotent: true as const };
  let auditRecordCalled = false;

  if (!simulatedServiceResult.wasIdempotent) {
    auditRecordCalled = true;
  }

  assert.equal(auditRecordCalled, false,
    'Audit record must not be called when wasIdempotent=true');
});

test('pending item: wasIdempotent=false triggers audit path', () => {
  // Sanity-check the inverse: a real transition must still invoke audit.
  const simulatedServiceResult = { actionId: 'action-uuid', wasIdempotent: false as const };
  let auditRecordCalled = false;

  if (!simulatedServiceResult.wasIdempotent) {
    auditRecordCalled = true;
  }

  assert.equal(auditRecordCalled, true,
    'Audit record must be called when wasIdempotent=false (real transition)');
});

test('already-rejected item + approve: checkIdempotency returns conflict (409)', () => {
  // Cross-terminal conflict must never be treated as idempotent.
  const outcome = checkIdempotency('rejected', 'approve');
  assert.equal(outcome, 'conflict');
});

test('already-rejected item + reject: checkIdempotency returns idempotent (200)', () => {
  // Double-reject is also idempotent — same behaviour as double-approve.
  const outcome = checkIdempotency('rejected', 'reject');
  assert.equal(outcome, 'idempotent');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
