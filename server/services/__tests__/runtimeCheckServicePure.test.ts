/**
 * runtimeCheckServicePure.test.ts — Pure-logic tests for runtimeCheckServicePure.
 *
 * Spec: tasks/builds/trust-verification-layer/spec.md §6.1, §6.2, §11.
 * Required coverage (per Chunk 2 test spec):
 *   1. All 5 RuntimeCheckState values map to the 3 operator badges
 *   2. evaluateApiStatus2xx: status ranges
 *   3. evaluateFieldMatch: each expectedShape, pass + fail
 *   4. evaluateRowExists: rowFound=true → pass, rowFound=false → fail
 *   5. evaluateExternalReturns: field present → pass, missing → fail
 *   6. classifyTimeoutAsInconclusive: state MUST be 'inconclusive', MUST NOT be 'fail'
 *   7. isCustomHandlerRegistered: false before, true after registerCustomHandler
 *
 * Run via: npx vitest run server/services/__tests__/runtimeCheckServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  collapseToOperatorBadge,
  evaluateApiStatus2xx,
  evaluateFieldMatch,
  evaluateRowExists,
  evaluateExternalReturns,
  classifyTimeoutAsInconclusive,
  registerCustomHandler,
  isCustomHandlerRegistered,
  assertCustomHandlerRegistered,
} from '../runtimeCheckServicePure.js';
import type { RuntimeCheckState } from '../../../shared/types/runtimeCheck.js';

// ── 1. collapseToOperatorBadge — all 5 states map to 3 badges ─────────────────

test('collapseToOperatorBadge: pass → pass', () => {
  expect(collapseToOperatorBadge('pass')).toBe('pass');
});

test('collapseToOperatorBadge: fail → fail', () => {
  expect(collapseToOperatorBadge('fail')).toBe('fail');
});

test('collapseToOperatorBadge: inconclusive → pending', () => {
  expect(collapseToOperatorBadge('inconclusive')).toBe('pending');
});

test('collapseToOperatorBadge: pending → pending', () => {
  expect(collapseToOperatorBadge('pending')).toBe('pending');
});

test('collapseToOperatorBadge: not_applicable → pending', () => {
  expect(collapseToOperatorBadge('not_applicable')).toBe('pending');
});

test('collapseToOperatorBadge: permutation — all 5 internal states produce one of 3 badges', () => {
  const states: RuntimeCheckState[] = ['pass', 'fail', 'inconclusive', 'pending', 'not_applicable'];
  const validBadges = new Set(['pass', 'fail', 'pending']);
  for (const state of states) {
    expect(validBadges.has(collapseToOperatorBadge(state))).toBe(true);
  }
});

// ── 2. evaluateApiStatus2xx ────────────────────────────────────────────────────

test('evaluateApiStatus2xx: 200 → pass (default range)', () => {
  const result = evaluateApiStatus2xx(200);
  expect(result.state).toBe('pass');
});

test('evaluateApiStatus2xx: 201 → pass (in default 200-299 range)', () => {
  const result = evaluateApiStatus2xx(201);
  expect(result.state).toBe('pass');
});

test('evaluateApiStatus2xx: 299 → pass (upper boundary of default range)', () => {
  const result = evaluateApiStatus2xx(299);
  expect(result.state).toBe('pass');
});

test('evaluateApiStatus2xx: 400 → fail', () => {
  const result = evaluateApiStatus2xx(400);
  expect(result.state).toBe('fail');
  expect(result.reasonCode).toBe('api_status_out_of_range');
});

test('evaluateApiStatus2xx: 500 → fail', () => {
  const result = evaluateApiStatus2xx(500);
  expect(result.state).toBe('fail');
});

test('evaluateApiStatus2xx: 300 → fail (just outside default range)', () => {
  const result = evaluateApiStatus2xx(300);
  expect(result.state).toBe('fail');
});

test('evaluateApiStatus2xx: custom range [200, 201] — 201 passes, 202 fails', () => {
  expect(evaluateApiStatus2xx(201, [200, 201]).state).toBe('pass');
  expect(evaluateApiStatus2xx(202, [200, 201]).state).toBe('fail');
});

test('evaluateApiStatus2xx: custom range [200, 299] — 200 passes', () => {
  const result = evaluateApiStatus2xx(200, [200, 299]);
  expect(result.state).toBe('pass');
});

test('evaluateApiStatus2xx: invalid input (null) → inconclusive', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = evaluateApiStatus2xx(null as any);
  expect(result.state).toBe('inconclusive');
  expect(result.reasonCode).toBe('invalid_check_definition');
});

// ── 3. evaluateFieldMatch — each expectedShape, pass + fail ───────────────────

test('evaluateFieldMatch: string value → pass', () => {
  const result = evaluateFieldMatch('hello', 'output.name', 'string');
  expect(result.state).toBe('pass');
});

test('evaluateFieldMatch: number where string expected → fail', () => {
  const result = evaluateFieldMatch(42, 'output.name', 'string');
  expect(result.state).toBe('fail');
  expect(result.reasonCode).toBe('field_shape_mismatch');
});

test('evaluateFieldMatch: number value → pass', () => {
  const result = evaluateFieldMatch(42, 'output.count', 'number');
  expect(result.state).toBe('pass');
});

test('evaluateFieldMatch: string where number expected → fail', () => {
  const result = evaluateFieldMatch('42', 'output.count', 'number');
  expect(result.state).toBe('fail');
  expect(result.reasonCode).toBe('field_shape_mismatch');
});

test('evaluateFieldMatch: boolean true → pass', () => {
  const result = evaluateFieldMatch(true, 'output.success', 'boolean');
  expect(result.state).toBe('pass');
});

test('evaluateFieldMatch: boolean false → pass (false is still a boolean)', () => {
  const result = evaluateFieldMatch(false, 'output.success', 'boolean');
  expect(result.state).toBe('pass');
});

test('evaluateFieldMatch: string where boolean expected → fail', () => {
  const result = evaluateFieldMatch('true', 'output.success', 'boolean');
  expect(result.state).toBe('fail');
  expect(result.reasonCode).toBe('field_shape_mismatch');
});

test('evaluateFieldMatch: ISO date string → pass', () => {
  const result = evaluateFieldMatch('2024-01-15T10:30:00Z', 'output.createdAt', 'date');
  expect(result.state).toBe('pass');
});

test('evaluateFieldMatch: non-date string where date expected → fail', () => {
  const result = evaluateFieldMatch('not-a-date', 'output.createdAt', 'date');
  expect(result.state).toBe('fail');
  expect(result.reasonCode).toBe('field_shape_mismatch');
});

test('evaluateFieldMatch: number where date expected → fail', () => {
  const result = evaluateFieldMatch(12345, 'output.createdAt', 'date');
  expect(result.state).toBe('fail');
  expect(result.reasonCode).toBe('field_shape_mismatch');
});

test('evaluateFieldMatch: null value → inconclusive', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = evaluateFieldMatch(null as any, 'output.name', 'string');
  expect(result.state).toBe('inconclusive');
  expect(result.reasonCode).toBe('invalid_check_definition');
});

// ── 4. evaluateRowExists ───────────────────────────────────────────────────────

test('evaluateRowExists: rowFound=true → pass', () => {
  const result = evaluateRowExists(true);
  expect(result.state).toBe('pass');
  expect(result.reasonCode).toBe('row_found');
});

test('evaluateRowExists: rowFound=false → fail', () => {
  const result = evaluateRowExists(false);
  expect(result.state).toBe('fail');
  expect(result.reasonCode).toBe('row_not_found');
});

// ── 5. evaluateExternalReturns ─────────────────────────────────────────────────

test('evaluateExternalReturns: result has expectedField → pass', () => {
  const result = evaluateExternalReturns({ messageId: 'msg_123', status: 'delivered' }, 'twilio', 'messageId');
  expect(result.state).toBe('pass');
  expect(result.reasonCode).toBe('external_field_present');
});

test('evaluateExternalReturns: result missing expectedField → fail', () => {
  const result = evaluateExternalReturns({ status: 'error' }, 'twilio', 'messageId');
  expect(result.state).toBe('fail');
  expect(result.reasonCode).toBe('external_field_missing');
});

test('evaluateExternalReturns: non-object result → inconclusive', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = evaluateExternalReturns('string-response' as any, 'twilio', 'messageId');
  expect(result.state).toBe('inconclusive');
  expect(result.reasonCode).toBe('invalid_check_definition');
});

test('evaluateExternalReturns: null result → inconclusive', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = evaluateExternalReturns(null as any, 'stripe', 'id');
  expect(result.state).toBe('inconclusive');
  expect(result.reasonCode).toBe('invalid_check_definition');
});

test('evaluateExternalReturns: field present with undefined value → fail (undefined is not present)', () => {
  const result = evaluateExternalReturns({ messageId: undefined }, 'twilio', 'messageId');
  expect(result.state).toBe('fail');
});

// ── 6. classifyTimeoutAsInconclusive ──────────────────────────────────────────

test('classifyTimeoutAsInconclusive: state MUST be inconclusive', () => {
  const result = classifyTimeoutAsInconclusive('send_email', 3);
  expect(result.state).toBe('inconclusive');
});

test('classifyTimeoutAsInconclusive: state MUST NOT be fail', () => {
  const result = classifyTimeoutAsInconclusive('crm.send_sms', 1);
  expect(result.state).not.toBe('fail');
});

test('classifyTimeoutAsInconclusive: reasonCode is check_timed_out', () => {
  const result = classifyTimeoutAsInconclusive('send_email', 2);
  expect(result.reasonCode).toBe('check_timed_out');
});

test('classifyTimeoutAsInconclusive: reasonText mentions skill slug', () => {
  const result = classifyTimeoutAsInconclusive('crm.fire_automation', 5);
  expect(result.reasonText).toContain('crm.fire_automation');
});

// ── 7. custom handler registration ────────────────────────────────────────────

test('isCustomHandlerRegistered: returns false before registration', () => {
  expect(isCustomHandlerRegistered('my_unique_handler_xyz_abc')).toBe(false);
});

test('isCustomHandlerRegistered: returns true after registerCustomHandler', () => {
  registerCustomHandler('my_unique_handler_xyz_abc');
  expect(isCustomHandlerRegistered('my_unique_handler_xyz_abc')).toBe(true);
});

test('registerCustomHandler: idempotent — registering same name twice is safe', () => {
  registerCustomHandler('idempotent_handler_test');
  registerCustomHandler('idempotent_handler_test');
  expect(isCustomHandlerRegistered('idempotent_handler_test')).toBe(true);
});

test('isCustomHandlerRegistered: different handler names are independent', () => {
  registerCustomHandler('handler_a_unique');
  expect(isCustomHandlerRegistered('handler_a_unique')).toBe(true);
  expect(isCustomHandlerRegistered('handler_b_unique')).toBe(false);
});

test('assertCustomHandlerRegistered: throws and thrown value is instanceof Error', () => {
  expect(() => assertCustomHandlerRegistered('unregistered_handler_xyz')).toThrow(Error);
});

test('assertCustomHandlerRegistered: thrown error has state: inconclusive', () => {
  let thrown: unknown;
  try {
    assertCustomHandlerRegistered('unregistered_handler_xyz');
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as { state: string }).state).toBe('inconclusive');
});

// ── evaluateFieldMatch: non-ISO date string rejected ──────────────────────────

test('evaluateFieldMatch: non-ISO date string "January 1, 2024" → fail', () => {
  const result = evaluateFieldMatch('January 1, 2024', 'output.createdAt', 'date');
  expect(result.state).toBe('fail');
  expect(result.reasonCode).toBe('field_shape_mismatch');
});

// ── evaluateExternalReturns: array result → inconclusive ──────────────────────

test('evaluateExternalReturns: array result → inconclusive (malformed response)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = evaluateExternalReturns(['item1', 'item2'] as any, 'twilio', 'messageId');
  expect(result.state).toBe('inconclusive');
  expect(result.reasonCode).toBe('invalid_check_definition');
});
