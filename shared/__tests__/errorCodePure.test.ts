/**
 * errorCodePure.test.ts
 *
 * Run via:
 *   npx tsx shared/__tests__/errorCodePure.test.ts
 */

import { expect, test } from 'vitest';
import { getErrorCode } from '../errorCode.js';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Branch A — flat string code
test('flat string code', () => {
  expect(getErrorCode('approval_already_decided'), 'flat string').toBe('approval_already_decided');
});

test('empty string returns null', () => {
  expect(getErrorCode(''), 'empty').toBe(null);
});

// `{ code: ... }` envelope (nested-style return)
test('object with .code', () => {
  expect(getErrorCode({ code: 'permission_denied' }), '.code').toBe('permission_denied');
});

test('object with non-string .code returns null', () => {
  expect(getErrorCode({ code: 42 }), '.code numeric').toBe(null);
});

// `{ error: 'code_string' }` (HTTP body style)
test('object with .error string', () => {
  expect(getErrorCode({ error: 'artefact_not_found' }), '.error string').toBe('artefact_not_found');
});

test('object with .error nested', () => {
  expect(getErrorCode({ error: { code: 'rate_limited', message: 'too many', context: {} } }), '.error.code').toBe('rate_limited');
});

test('mixed: status + error shape', () => {
  expect(getErrorCode({ status: 'failed', error: 'artefact_stale' }), 'status + error').toBe('artefact_stale');
});

// Edge cases
test('null returns null', () => {
  expect(getErrorCode(null), 'null').toBe(null);
});

test('undefined returns null', () => {
  expect(getErrorCode(undefined), 'undefined').toBe(null);
});

test('number returns null', () => {
  expect(getErrorCode(404), 'number').toBe(null);
});

test('object without code/error returns null', () => {
  expect(getErrorCode({ foo: 'bar' }), 'unrelated obj').toBe(null);
});

test('object with empty .code returns null', () => {
  expect(getErrorCode({ code: '' }), 'empty .code').toBe(null);
});

test('Error-like object with .code is recognised', () => {
  const err: { name: string; message: string; code: string } = {
    name: 'CustomError',
    message: 'something broke',
    code: 'custom_failure',
  };
  expect(getErrorCode(err), 'Error-like .code').toBe('custom_failure');
});

test('thrown Error without .code returns defaultCode', () => {
  const err = new Error('connection refused');
  expect(getErrorCode(err), 'no default → null').toBe(null);
  expect(getErrorCode(err, 'unknown_error'), 'with default').toBe('unknown_error');
});

test('null with defaultCode returns the default', () => {
  expect(getErrorCode(null, 'unknown_error'), 'null + default').toBe('unknown_error');
});

test('Error.message is NOT treated as the code', () => {
  // Critical: free-text messages are not stable codes. The helper must
  // refuse to elevate a thrown Error's message to the code slot — that
  // would let consumers branch on user-visible English strings.
  const err = new Error('approval_already_decided');
  expect(getErrorCode(err), 'message-as-code is rejected').toBe(null);
});

test('defaultCode is returned for unrelated objects', () => {
  expect(getErrorCode({ foo: 'bar' }, 'unknown_error'), 'unrelated obj + default').toBe('unknown_error');
});

console.log('');
