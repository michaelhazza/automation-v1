/**
 * reviewServicePure.test.ts — Pure idempotency-check tests for reviewService.
 *
 * Spec §6.2.1 (clientpulse-ui-simplification):
 *   - Double-approve → idempotent (200, no re-emit, no re-enqueue)
 *   - Double-reject  → idempotent (200)
 *   - Approve an already-rejected item → 409 ITEM_CONFLICT
 *   - Reject an already-approved item  → 409 ITEM_CONFLICT
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/reviewServicePure.test.ts
 */

import { expect, test } from 'vitest';
import { strict as assert } from 'node:assert';
import { checkIdempotency } from '../reviewServicePure.js';
import type { ReviewStatus, RequestedAction } from '../reviewServicePure.js';

console.log('');
console.log('reviewServicePure — idempotency decision helper (spec §6.2.1)');
console.log('');

// ─── pending items: should always proceed ────────────────────────────────────

test('pending + approve → proceed', () => {
  assert.equal(checkIdempotency('pending', 'approve'), 'proceed');
});

test('pending + reject → proceed', () => {
  assert.equal(checkIdempotency('pending', 'reject'), 'proceed');
});

test('edited_pending + approve → proceed', () => {
  assert.equal(checkIdempotency('edited_pending', 'approve'), 'proceed');
});

test('edited_pending + reject → proceed', () => {
  assert.equal(checkIdempotency('edited_pending', 'reject'), 'proceed');
});

// ─── double-approve: idempotent replay ───────────────────────────────────────

test('already approved + approve → idempotent (second call returns existing row)', () => {
  // This is the "double-approve" case — no re-audit, no re-enqueue
  assert.equal(checkIdempotency('approved', 'approve'), 'idempotent');
});

test('completed (post-execution) + approve → idempotent', () => {
  // Items move to "completed" after execution succeeds; a late retry must
  // still be treated as idempotent, not a conflict.
  assert.equal(checkIdempotency('completed', 'approve'), 'idempotent');
});

// ─── double-reject: idempotent replay ────────────────────────────────────────

test('already rejected + reject → idempotent (second call returns existing row)', () => {
  assert.equal(checkIdempotency('rejected', 'reject'), 'idempotent');
});

// ─── cross-terminal conflicts: 409 ITEM_CONFLICT ─────────────────────────────

test('already rejected + approve → conflict', () => {
  // Caller is requesting approve on a rejected item → 409 ITEM_CONFLICT
  assert.equal(checkIdempotency('rejected', 'approve'), 'conflict');
});

test('already approved + reject → conflict', () => {
  // Caller is requesting reject on an approved item → 409 ITEM_CONFLICT
  assert.equal(checkIdempotency('approved', 'reject'), 'conflict');
});

test('completed + reject → conflict', () => {
  // Item executed successfully (completed); rejecting it now is a conflict
  assert.equal(checkIdempotency('completed', 'reject'), 'conflict');
});

// ─── not_found ────────────────────────────────────────────────────────────────

test('undefined status + approve → not_found', () => {
  assert.equal(checkIdempotency(undefined, 'approve'), 'not_found');
});

test('undefined status + reject → not_found', () => {
  assert.equal(checkIdempotency(undefined, 'reject'), 'not_found');
});

// ─── exhaustive cross-product spot-check ─────────────────────────────────────
// Verify the full status × action matrix to catch any missed branches.

const statusActionMatrix: Array<[ReviewStatus | undefined, RequestedAction, string]> = [
  ['pending',        'approve', 'proceed'],
  ['pending',        'reject',  'proceed'],
  ['edited_pending', 'approve', 'proceed'],
  ['edited_pending', 'reject',  'proceed'],
  ['approved',       'approve', 'idempotent'],
  ['approved',       'reject',  'conflict'],
  ['rejected',       'approve', 'conflict'],
  ['rejected',       'reject',  'idempotent'],
  ['completed',      'approve', 'idempotent'],
  ['completed',      'reject',  'conflict'],
  [undefined,        'approve', 'not_found'],
  [undefined,        'reject',  'not_found'],
];

test('full status × action matrix', () => {
  for (const [status, action, expected] of statusActionMatrix) {
    const actual = checkIdempotency(status, action);
    assert.equal(
      actual,
      expected,
      `status=${String(status)} action=${action} → expected ${expected}, got ${actual}`,
    );
  }
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('');
console.log('');
