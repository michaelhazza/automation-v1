/**
 * skillAmendmentServiceStateMachinePure.test.ts
 *
 * Pure-function tests confirming the amendment state machine transition rules
 * match spec §18.6. Run via:
 *   npx vitest run server/services/__tests__/skillAmendmentServiceStateMachinePure.test.ts
 */

import { test, expect } from 'vitest';
import { assertValidAmendmentTransition } from '../skillAmendmentServiceStateMachinePure.js';

// ── Valid transitions ─────────────────────────────────────────────────────────

test('draft → pending_review is allowed', () => {
  expect(() => assertValidAmendmentTransition({ from: 'draft', to: 'pending_review' })).not.toThrow();
});

test('pending_review → accepted is allowed', () => {
  expect(() => assertValidAmendmentTransition({ from: 'pending_review', to: 'accepted' })).not.toThrow();
});

test('pending_review → rejected is allowed', () => {
  expect(() => assertValidAmendmentTransition({ from: 'pending_review', to: 'rejected' })).not.toThrow();
});

test('pending_review → retired with reason=stale is allowed', () => {
  expect(() => assertValidAmendmentTransition({ from: 'pending_review', to: 'retired', reason: 'stale' })).not.toThrow();
});

test('pending_review → retired with reason=superseded is allowed', () => {
  expect(() => assertValidAmendmentTransition({ from: 'pending_review', to: 'retired', reason: 'superseded' })).not.toThrow();
});

test('accepted → retired with reason=graceful is allowed', () => {
  expect(() => assertValidAmendmentTransition({ from: 'accepted', to: 'retired', reason: 'graceful' })).not.toThrow();
});

test('accepted → retired with reason=rollback is allowed', () => {
  expect(() => assertValidAmendmentTransition({ from: 'accepted', to: 'retired', reason: 'rollback' })).not.toThrow();
});

test('accepted → retired with reason=stale is allowed', () => {
  expect(() => assertValidAmendmentTransition({ from: 'accepted', to: 'retired', reason: 'stale' })).not.toThrow();
});

test('accepted → retired with reason=superseded is allowed', () => {
  expect(() => assertValidAmendmentTransition({ from: 'accepted', to: 'retired', reason: 'superseded' })).not.toThrow();
});

test('accepted → retired with reason=baseline_reset is allowed', () => {
  expect(() => assertValidAmendmentTransition({ from: 'accepted', to: 'retired', reason: 'baseline_reset' })).not.toThrow();
});

// ── Forbidden: terminal states ────────────────────────────────────────────────

test('rejected → accepted throws (terminal state)', () => {
  expect(() => assertValidAmendmentTransition({ from: 'rejected', to: 'accepted' })).toThrow();
});

test('rejected → pending_review throws (terminal state)', () => {
  expect(() => assertValidAmendmentTransition({ from: 'rejected', to: 'pending_review' })).toThrow();
});

test('rejected → retired throws (terminal state)', () => {
  expect(() => assertValidAmendmentTransition({ from: 'rejected', to: 'retired', reason: 'stale' })).toThrow();
});

test('rejected → draft throws (terminal state)', () => {
  expect(() => assertValidAmendmentTransition({ from: 'rejected', to: 'draft' })).toThrow();
});

test('retired → accepted throws (terminal state)', () => {
  expect(() => assertValidAmendmentTransition({ from: 'retired', to: 'accepted' })).toThrow();
});

test('retired → pending_review throws (terminal state)', () => {
  expect(() => assertValidAmendmentTransition({ from: 'retired', to: 'pending_review' })).toThrow();
});

test('retired → draft throws (terminal state)', () => {
  expect(() => assertValidAmendmentTransition({ from: 'retired', to: 'draft' })).toThrow();
});

// ── Forbidden: draft shortcuts ────────────────────────────────────────────────

test('draft → accepted throws (cannot skip pending_review per §18.1)', () => {
  expect(() => assertValidAmendmentTransition({ from: 'draft', to: 'accepted' })).toThrow();
});

test('draft → rejected throws', () => {
  expect(() => assertValidAmendmentTransition({ from: 'draft', to: 'rejected' })).toThrow();
});

test('draft → retired throws', () => {
  expect(() => assertValidAmendmentTransition({ from: 'draft', to: 'retired', reason: 'stale' })).toThrow();
});

// ── Forbidden: accepted → rejected (spec §18.6 explicit prohibition) ──────────

test('accepted → rejected throws (explicitly forbidden per §18.6)', () => {
  expect(() => assertValidAmendmentTransition({ from: 'accepted', to: 'rejected' })).toThrow();
});

test('accepted → draft throws', () => {
  expect(() => assertValidAmendmentTransition({ from: 'accepted', to: 'draft' })).toThrow();
});

test('accepted → pending_review throws', () => {
  expect(() => assertValidAmendmentTransition({ from: 'accepted', to: 'pending_review' })).toThrow();
});

// ── Forbidden: wrong retire reason for the from-state ────────────────────────

test('pending_review → retired with reason=rollback throws (not valid for this transition)', () => {
  expect(() => assertValidAmendmentTransition({ from: 'pending_review', to: 'retired', reason: 'rollback' })).toThrow();
});

test('pending_review → retired with reason=graceful throws (not valid for this transition)', () => {
  expect(() => assertValidAmendmentTransition({ from: 'pending_review', to: 'retired', reason: 'graceful' })).toThrow();
});

test('pending_review → retired with reason=baseline_reset throws (not valid for this transition)', () => {
  expect(() => assertValidAmendmentTransition({ from: 'pending_review', to: 'retired', reason: 'baseline_reset' })).toThrow();
});

test('pending_review → retired without reason throws', () => {
  expect(() => assertValidAmendmentTransition({ from: 'pending_review', to: 'retired' })).toThrow();
});

test('accepted → retired without reason throws', () => {
  expect(() => assertValidAmendmentTransition({ from: 'accepted', to: 'retired' })).toThrow();
});

// ── Error shape ───────────────────────────────────────────────────────────────

test('thrown object has statusCode 422 and errorCode invalid_transition', () => {
  let caught: unknown;
  try {
    assertValidAmendmentTransition({ from: 'accepted', to: 'rejected' });
  } catch (err) {
    caught = err;
  }
  expect(caught).toMatchObject({
    statusCode: 422,
    message: 'invalid_amendment_transition',
    errorCode: 'invalid_transition',
  });
});
