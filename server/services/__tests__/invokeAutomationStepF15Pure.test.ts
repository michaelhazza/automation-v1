/**
 * invokeAutomationStepF15Pure.test.ts
 *
 * Pure-function tests for F15: validateInputAgainstSchema helper.
 * Tests the schema-validation helper exported from invokeAutomationStepPure.
 * Does NOT require a real Postgres instance.
 *
 * Run via: npx tsx server/services/__tests__/invokeAutomationStepF15Pure.test.ts
 */

import { validateInputAgainstSchema } from '../invokeAutomationStepPure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
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

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

console.log('\ninvokeAutomationStep F15 — validateInputAgainstSchema tests\n');

test('null schema → ok: true (best-effort skip)', () => {
  const result = validateInputAgainstSchema({ foo: 'bar' }, null);
  assert(result.ok === true, 'null schemaText should pass validation (skip)');
});

test('empty string schema → ok: true (best-effort skip)', () => {
  const result = validateInputAgainstSchema({ foo: 'bar' }, '');
  assert(result.ok === true, 'empty schemaText should pass validation (skip)');
});

test('unparseable JSON schema → ok: true (best-effort skip)', () => {
  const result = validateInputAgainstSchema({ foo: 'bar' }, '{not valid json');
  assert(result.ok === true, 'unparseable schema should pass validation (skip)');
});

test('parseable + valid → ok: true', () => {
  const schema = JSON.stringify({
    properties: { name: { type: 'string' } },
    required: ['name'],
  });
  const result = validateInputAgainstSchema({ name: 'Alice' }, schema);
  assert(result.ok === true, `Expected ok:true, got ok:false with errors: ${result.ok ? '' : (result as { ok: false; errors: string[] }).errors.join(', ')}`);
});

test('parseable + invalid (missing required field) → ok: false with errors', () => {
  const schema = JSON.stringify({
    properties: { name: { type: 'string' } },
    required: ['name'],
  });
  const result = validateInputAgainstSchema({}, schema);
  assert(result.ok === false, 'Missing required field should fail validation');
  if (!result.ok) {
    assert(Array.isArray(result.errors) && result.errors.length > 0, 'Should return error messages');
  }
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
