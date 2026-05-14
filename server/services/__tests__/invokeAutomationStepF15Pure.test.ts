/**
 * invokeAutomationStepF15Pure.test.ts
 *
 * Pure-function tests for F15: validateInputAgainstSchema helper.
 * Tests the schema-validation helper exported from invokeAutomationStepPure.
 * Does NOT require a real Postgres instance.
 *
 * Run via: npx tsx server/services/__tests__/invokeAutomationStepF15Pure.test.ts
 */

import { expect, test } from 'vitest';
import { validateInputAgainstSchema } from '../invokeAutomationStepPure.js';

console.log('\ninvokeAutomationStep F15 — validateInputAgainstSchema tests\n');

test('null schema → ok: true (best-effort skip)', () => {
  const result = validateInputAgainstSchema({ foo: 'bar' }, null);
  expect(result.ok === true, 'null schemaText should pass validation (skip)').toBeTruthy();
});

test('empty string schema → ok: true (best-effort skip)', () => {
  const result = validateInputAgainstSchema({ foo: 'bar' }, '');
  expect(result.ok === true, 'empty schemaText should pass validation (skip)').toBeTruthy();
});

test('unparseable JSON schema → ok: true (best-effort skip)', () => {
  const result = validateInputAgainstSchema({ foo: 'bar' }, '{not valid json');
  expect(result.ok === true, 'unparseable schema should pass validation (skip)').toBeTruthy();
});

test('parseable + valid → ok: true', () => {
  const schema = JSON.stringify({
    properties: { name: { type: 'string' } },
    required: ['name'],
  });
  const result = validateInputAgainstSchema({ name: 'Alice' }, schema);
  expect(result.ok === true, `Expected ok:true, got ok:false with errors: ${result.ok ? '' : (result as { ok: false; errors: string[] }).errors.join(', ')}`).toBeTruthy();
});

test('parseable + invalid (missing required field) → ok: false with errors', () => {
  const schema = JSON.stringify({
    properties: { name: { type: 'string' } },
    required: ['name'],
  });
  const result = validateInputAgainstSchema({}, schema);
  expect(result.ok === false, 'Missing required field should fail validation').toBeTruthy();
  if (!result.ok) {
    expect(Array.isArray(result.errors) && result.errors.length > 0, 'Should return error messages').toBeTruthy();
  }
});
