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
import { checkIdempotency } from '../reviewServicePure.js';
import type { ReviewStatus, RequestedAction } from '../reviewServicePure.js';

console.log('');
console.log('reviewServicePure — idempotency decision helper (spec §6.2.1)');
console.log('');

// ─── pending items: should always proceed ────────────────────────────────────

test('pending + approve → proceed', () => {
  expect(checkIdempotency('pending', 'approve')).toBe('proceed');
});

test('pending + reject → proceed', () => {
  expect(checkIdempotency('pending', 'reject')).toBe('proceed');
});

test('edited_pending + approve → proceed', () => {
  expect(checkIdempotency('edited_pending', 'approve')).toBe('proceed');
});

test('edited_pending + reject → proceed', () => {
  expect(checkIdempotency('edited_pending', 'reject')).toBe('proceed');
});

// ─── double-approve: idempotent replay ───────────────────────────────────────

test('already approved + approve → idempotent (second call returns existing row)', () => {
  // This is the "double-approve" case — no re-audit, no re-enqueue
  expect(checkIdempotency('approved', 'approve')).toBe('idempotent');
});

test('completed (post-execution) + approve → idempotent', () => {
  // Items move to "completed" after execution succeeds; a late retry must
  // still be treated as idempotent, not a conflict.
  expect(checkIdempotency('completed', 'approve')).toBe('idempotent');
});

// ─── double-reject: idempotent replay ────────────────────────────────────────

test('already rejected + reject → idempotent (second call returns existing row)', () => {
  expect(checkIdempotency('rejected', 'reject')).toBe('idempotent');
});

// ─── cross-terminal conflicts: 409 ITEM_CONFLICT ─────────────────────────────

test('already rejected + approve → conflict', () => {
  // Caller is requesting approve on a rejected item → 409 ITEM_CONFLICT
  expect(checkIdempotency('rejected', 'approve')).toBe('conflict');
});

test('already approved + reject → conflict', () => {
  // Caller is requesting reject on an approved item → 409 ITEM_CONFLICT
  expect(checkIdempotency('approved', 'reject')).toBe('conflict');
});

test('completed + reject → conflict', () => {
  // Item executed successfully (completed); rejecting it now is a conflict
  expect(checkIdempotency('completed', 'reject')).toBe('conflict');
});

// ─── not_found ────────────────────────────────────────────────────────────────

test('undefined status + approve → not_found', () => {
  expect(checkIdempotency(undefined, 'approve')).toBe('not_found');
});

test('undefined status + reject → not_found', () => {
  expect(checkIdempotency(undefined, 'reject')).toBe('not_found');
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
    expect(actual).toBe(expected);
  }
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('');
console.log('');
